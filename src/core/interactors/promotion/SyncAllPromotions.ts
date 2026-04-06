import { AppConfig } from '@app/drivers/config/AppConfig';
import {
  EligibleItem,
  MercadolibreApiRepository,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import {
  Promotion,
  PromotionStatus,
  PromotionType,
} from '@core/entities/Promotion';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';

export interface SyncAllPromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface SyncAllPromotionsBuilder {
  mercadolibreApiRepository: MercadolibreApiRepository;
  priceApiRepository: PriceApiRepository;
  saveAllPromotion: SaveAllPromotion;
  config: AppConfig;
}

export class SyncAllPromotions {
  constructor(private readonly builder: SyncAllPromotionsBuilder) {}

  async execute(input: SyncAllPromotionsInput): Promise<ProcessResult> {
    const promotions = await this.builder.mercadolibreApiRepository.getPromotions();
    const consolidated: Promotion[] = [];
    let failure = 0;

    for (const promotionCatalog of promotions) {
      const eligibleItems = await this.builder.mercadolibreApiRepository.getEligibleItems(
        promotionCatalog.promotionId,
      );

      for (const item of eligibleItems) {
        try {
          const promotion = await this.buildPromotion(
            promotionCatalog.promotionId,
            promotionCatalog.type,
            item,
            input,
          );
          consolidated.push(promotion);
        } catch (error) {
          failure += 1;
          const message = error instanceof Error ? error.message : 'Unknown sync error';
          Logger.error(
            JSON.stringify({
              message: 'Promotion sync item failed',
              process: 'sync',
              sourceProcess: input.sourceProcess,
              sellerId: item.sellerId,
              itemId: item.itemId,
              promotionId: promotionCatalog.promotionId,
              reason: message,
            }),
          );
        }
      }
    }

    await this.builder.saveAllPromotion.saveAll(consolidated);

    return {
      process: 'sync',
      total: consolidated.length + failure,
      success: consolidated.length,
      failure,
      skipped: 0,
    };
  }

  private async buildPromotion(
    promotionId: string,
    promotionType: PromotionType | undefined,
    eligibleItem: EligibleItem,
    input: SyncAllPromotionsInput,
  ): Promise<Promotion> {
    const detail = await this.builder.mercadolibreApiRepository.getItemDetail(eligibleItem.itemId);
    const suggestedPrice = eligibleItem.suggestedPrice ?? detail.suggestedPrice ?? detail.listPrice ?? 0;
    const metrics = await this.builder.priceApiRepository.getMetrics({
      itemId: eligibleItem.itemId,
      salePrice: suggestedPrice,
    });

    const now = new Date();
    return {
      promotionId,
      itemId: eligibleItem.itemId,
      sellerId: eligibleItem.sellerId ?? detail.sellerId,
      type: promotionType ?? PromotionType.UNKNOWN,
      status: PromotionStatus.SYNCED,
      prices: {
        list: eligibleItem.listPrice ?? detail.listPrice,
        suggested: suggestedPrice,
        strikethrough: eligibleItem.strikethroughPrice ?? detail.strikethroughPrice,
      },
      economics: {
        cost: metrics.cost,
        profit: metrics.profit,
        profitability: metrics.profitability,
        margin: metrics.margin,
        minAllowedProfitability: this.builder.config.defaultMinProfitability,
      },
      metadata: {
        syncedAt: now,
        updatedBy: input.updatedBy,
        sourceProcess: input.sourceProcess,
        statusReason: 'Promotion synchronized and enriched',
      },
      auditTrail: [
        {
          process: input.sourceProcess,
          status: PromotionStatus.SYNCED,
          executedAt: now,
          reason: 'Promotion synchronized',
        },
      ],
    };
  }
}
