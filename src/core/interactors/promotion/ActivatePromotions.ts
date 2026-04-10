import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { MercadolibreApiRepository } from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';

export interface ActivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface ActivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  config: AppConfig;
}

export class ActivatePromotions {
  constructor(private readonly builder: ActivatePromotionsBuilder) {}

  async execute(input: ActivatePromotionsInput): Promise<ProcessResult> {
    const promotions = await this.builder.promotionRepository.findPendingActivation();
    let success = 0;
    let failure = 0;
    let skipped = 0;

    for (const promotion of promotions) {
      if (!this.meetsProfitabilityRules(promotion)) {
        skipped += 1;
        continue;
      }

      try {
        const response = await this.builder.mercadolibreApiRepository.activatePromotion({
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
        });

        const updatedPromotion: Promotion = {
          ...promotion,
          status: PromotionStatus.ACTIVE,
          offerId: response.offerId ?? promotion.offerId,
          metadata: {
            ...promotion.metadata,
            activatedAt: new Date(),
            updatedBy: input.updatedBy,
            sourceProcess: input.sourceProcess,
            statusReason: 'Promotion activated automatically',
          },
          auditTrail: [
            ...promotion.auditTrail,
            {
              process: input.sourceProcess,
              status: PromotionStatus.ACTIVE,
              reason: 'Profitability rules passed',
              executedAt: new Date(),
            },
          ],
        };

        await this.builder.promotionRepository.update(updatedPromotion);
        success += 1;
      } catch (error) {
        failure += 1;
        const reason = error instanceof Error ? error.message : 'Unknown activation error';
        await this.builder.promotionRepository.update({
          ...promotion,
          status: PromotionStatus.FAILED_ACTIVATION,
          metadata: {
            ...promotion.metadata,
            updatedBy: input.updatedBy,
            sourceProcess: input.sourceProcess,
            statusReason: reason,
            reason,
          },
          auditTrail: [
            ...promotion.auditTrail,
            {
              process: input.sourceProcess,
              status: PromotionStatus.FAILED_ACTIVATION,
              reason,
              executedAt: new Date(),
            },
          ],
        });
        Logger.error(
          JSON.stringify({
            message: 'Promotion activation failed',
            process: 'activate',
            sourceProcess: input.sourceProcess,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            reason,
          }),
        );
      }
    }

    return {
      process: 'activate',
      total: promotions.length,
      success,
      failure,
      skipped,
    };
  }

  private meetsProfitabilityRules(promotion: Promotion): boolean {
    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    const profit = promotion.economics.profit ?? Number.NEGATIVE_INFINITY;
    const minAllowed = this.builder.config.defaultMinProfitability;

    return profitability >= minAllowed && profit >= this.builder.config.defaultMinProfit;
  }
}
