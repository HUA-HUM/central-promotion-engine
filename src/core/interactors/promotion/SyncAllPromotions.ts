import { AppConfig } from '@app/drivers/config/AppConfig';
import { CampaignMlaApiRepository } from '@core/adapters/repositories/ICampaignMlaApiRepository';
import {
  EligibleItem,
  MercadolibreApiRepository,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog, PromotionType } from '@core/entities/PromotionCatalog';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';

export interface SyncAllPromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface SyncAllPromotionsBuilder {
  campaignMlaApiRepository: CampaignMlaApiRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  priceApiRepository: PriceApiRepository;
  saveAllPromotion: SaveAllPromotion;
  config: AppConfig;
}

export class SyncAllPromotions {
  constructor(private readonly builder: SyncAllPromotionsBuilder) {}

  async execute(input: SyncAllPromotionsInput): Promise<ProcessResult> {
    const promotionCatalogs = (await this.builder.mercadolibreApiRepository.getPromotions())
      .filter((promotionCatalog) =>
        this.builder.config.syncPromotionTypes.includes(promotionCatalog.type),
      );
    await this.builder.saveAllPromotion.saveCatalogs(promotionCatalogs);
    let success = 0;
    let failure = 0;

    for (const promotionCatalog of promotionCatalogs) {
      let searchAfter: string | undefined;

      do {
        const response = await this.builder.mercadolibreApiRepository.getElegibleItemsPaginated(
          promotionCatalog.promotionId,
          promotionCatalog.type,
          searchAfter,
        );

        const consolidated: Promotion[] = [];
        const eligibleItems = response.results ?? [];

        if (eligibleItems.length === 0) {
          searchAfter = response.paging?.searchAfter;
          continue;
        }

        const mlas = eligibleItems.map((item) => item.itemId);
        const existingMlasResponse = await this.builder.campaignMlaApiRepository.existsBulk(mlas);
        const existingMlas = new Set(
          (existingMlasResponse.items ?? [])
            .filter((item) => item.exists)
            .map((item) => item.mla),
        );

        const enabledEligibleItems = eligibleItems.filter((item) => existingMlas.has(item.itemId));
        for (const item of enabledEligibleItems) {
          try {
            const promotion = await this.buildPromotion(
              promotionCatalog,
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
                itemId: item.itemId,
                promotionId: promotionCatalog.promotionId,
                reason: message,
              }),
            );
          }
        }

        if (consolidated.length > 0) {
          await this.builder.saveAllPromotion.saveAll(consolidated);
          success += consolidated.length;
        }

        console.log(`Processed promotion ${promotionCatalog.promotionId} page, success: ${success}, failure: ${failure}`);

        searchAfter = response.paging?.searchAfter;
      } while (searchAfter);
    }

    return {
      process: 'sync',
      total: success + failure,
      success,
      failure,
      skipped: 0,
    };
  }

  private async buildPromotion(
    promotionCatalog: PromotionCatalog,
    eligibleItem: EligibleItem,
    input: SyncAllPromotionsInput,
  ): Promise<Promotion> {
    const detail = await this.builder.mercadolibreApiRepository.getItemDetail(eligibleItem.itemId);
    const suggestedPrice = eligibleItem.suggestedPrice ?? detail.price ?? 0;
    const metrics = await this.builder.priceApiRepository.getMetrics({
      itemId: eligibleItem.itemId,
      salePrice: suggestedPrice,
    });

    const now = new Date();
    return {
      itemId: eligibleItem.itemId,
      promotionId: promotionCatalog.promotionId,
      name: promotionCatalog.name,
      type: promotionCatalog.type,
      status: PromotionStatus.SYNCED,
      offerId: eligibleItem.offerId,
      sku: detail.sku,
      categoryId: detail.categoryId,
      listingInfo: detail.listingInfo,
      prices: {
        originalPrice: eligibleItem.originalPrice,
        minPrice: eligibleItem.minPrice,
        maxPrice: eligibleItem.maxPrice,
        suggestedPrice: eligibleItem.suggestedPrice,
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
        statusReason: 'Promotion synchronized',
      },
      auditTrail: [
        {
          process: input.sourceProcess,
          status: PromotionStatus.SYNCED,
          executedAt: now,
          reason: 'Promotion synchronized',
        },
      ],
      terms: {
        resignation: {
            mercadolibre: {
              percentage: eligibleItem.meliPercentage,
              amount: eligibleItem.originalPrice * (eligibleItem.meliPercentage ?? 0) / 100,
            },
            seller: {
              percentage: eligibleItem.sellerPercentage,
              amount: eligibleItem.originalPrice * (eligibleItem.sellerPercentage ?? 0) / 100,
            },
            total: (eligibleItem.meliPercentage ?? 0) + (eligibleItem.sellerPercentage ?? 0),
        },
        pvp: {
          current: {},
          revenue: {},
          store: {},
        },
      },
    };
  }
}
