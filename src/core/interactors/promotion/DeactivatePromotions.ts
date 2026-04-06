import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { MercadolibreApiRepository } from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';

export interface DeactivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface DeactivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  priceApiRepository: PriceApiRepository;
  config: AppConfig;
}

export class DeactivatePromotions {
  constructor(private readonly builder: DeactivatePromotionsBuilder) {}

  async execute(input: DeactivatePromotionsInput): Promise<ProcessResult> {
    const promotions = await this.builder.promotionRepository.findActive();
    let success = 0;
    let failure = 0;
    let skipped = 0;

    for (const promotion of promotions) {
      try {
        const currentSalePrice = await this.builder.priceApiRepository.getCurrentSalePrice(
          promotion.itemId,
        );
        const currentMetrics = await this.builder.priceApiRepository.getMetrics({
          itemId: promotion.itemId,
          salePrice: currentSalePrice,
        });

        const updatedPromotion: Promotion = {
          ...promotion,
          prices: {
            ...promotion.prices,
            current: currentSalePrice,
          },
          economics: {
            ...promotion.economics,
            cost: currentMetrics.cost ?? promotion.economics.cost,
            profit: currentMetrics.profit ?? promotion.economics.profit,
            profitability: currentMetrics.profitability ?? promotion.economics.profitability,
            margin: currentMetrics.margin ?? promotion.economics.margin,
          },
        };

        if (this.stillMeetsRules(updatedPromotion)) {
          await this.builder.promotionRepository.update(updatedPromotion);
          skipped += 1;
          continue;
        }

        const action = promotion.offerId ? 'pause' : 'delete';
        await this.builder.mercadolibreApiRepository.pauseOrDeletePromotion({
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          sellerId: promotion.sellerId,
          offerId: promotion.offerId,
          action,
        });

        await this.builder.promotionRepository.update({
          ...updatedPromotion,
          status: action === 'pause' ? PromotionStatus.PAUSED : PromotionStatus.DELETED,
          metadata: {
            ...updatedPromotion.metadata,
            deactivatedAt: new Date(),
            updatedBy: input.updatedBy,
            sourceProcess: input.sourceProcess,
            reason: 'Promotion no longer meets profitability rules',
            statusReason: `Promotion ${action}d automatically`,
          },
          auditTrail: [
            ...updatedPromotion.auditTrail,
            {
              process: input.sourceProcess,
              status: action === 'pause' ? PromotionStatus.PAUSED : PromotionStatus.DELETED,
              reason: 'Current sale price no longer satisfies profitability rules',
              executedAt: new Date(),
            },
          ],
        });
        success += 1;
      } catch (error) {
        failure += 1;
        const reason = error instanceof Error ? error.message : 'Unknown deactivation error';
        await this.builder.promotionRepository.update({
          ...promotion,
          status: PromotionStatus.FAILED_DEACTIVATION,
          metadata: {
            ...promotion.metadata,
            updatedBy: input.updatedBy,
            sourceProcess: input.sourceProcess,
            reason,
            statusReason: reason,
          },
          auditTrail: [
            ...promotion.auditTrail,
            {
              process: input.sourceProcess,
              status: PromotionStatus.FAILED_DEACTIVATION,
              reason,
              executedAt: new Date(),
            },
          ],
        });
        Logger.error(
          JSON.stringify({
            message: 'Promotion deactivation failed',
            process: 'deactivate',
            sourceProcess: input.sourceProcess,
            sellerId: promotion.sellerId,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            reason,
          }),
        );
      }
    }

    return {
      process: 'deactivate',
      total: promotions.length,
      success,
      failure,
      skipped,
    };
  }

  private stillMeetsRules(promotion: Promotion): boolean {
    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    const profit = promotion.economics.profit ?? Number.NEGATIVE_INFINITY;
    const minAllowed =
      promotion.economics.minAllowedProfitability ?? this.builder.config.defaultMinProfitability;

    return profitability >= minAllowed && profit >= this.builder.config.defaultMinProfit;
  }
}
