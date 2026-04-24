import { AppConfig } from '@app/drivers/config/AppConfig';
import { IAPICampaignMlaApiRepository } from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import {
  EligibleItem,
  IAPIMercadolibreApiRepository,
  ItemDetail,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { IAPIPriceApiRepository } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion } from '@core/entities/Promotion';
import { PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog } from '@core/entities/PromotionCatalog';
import {
  PromotionBuilderInput,
} from '@core/interactors/promotion/models/Promotion';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';
import {
  PriceMetricsBulkResolver,
  PriceMetricsRequest,
} from '@core/interactors/promotion/services/PriceMetricsBulkResolver';

export interface SyncAllPromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface SyncAllPromotionsBuilder {
  campaignMlaApiRepository: IAPICampaignMlaApiRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  priceApiRepository: IAPIPriceApiRepository;
  saveAllPromotion: SaveAllPromotion;
  config: AppConfig;
}

export class SyncAllPromotions {
  private static readonly CAMPAIGN_EXISTS_BULK_LIMIT = 50;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;

  constructor(private readonly builder: SyncAllPromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
    this.promotionModelsRegistry = PromotionModelsRegistry.forSync(builder.priceApiRepository);
  }

  async execute(input: SyncAllPromotionsInput): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: 'Promotion sync process started',
        process: 'sync',
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
      }),
    );

    const promotionCatalogs = (await this.builder.mercadolibreApiRepository.getPromotions());
    const result = await this.syncPromotionCatalogs(promotionCatalogs, input, 'sync');

    const finishedAt = new Date();
    const durationMinutes = Number(
      ((finishedAt.getTime() - startedAt.getTime()) / 60000).toFixed(2),
    );

    Logger.info(
      JSON.stringify({
        message: 'Promotion sync process finished',
        process: result.process,
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMinutes,
        total: result.total,
        success: result.success,
        failure: result.failure,
        skipped: result.skipped,
      }),
    );

    return result;
  }

  async syncPromotionCatalogs(
    promotionCatalogs: PromotionCatalog[],
    input: SyncAllPromotionsInput,
    processName: string,
  ): Promise<ProcessResult> {
    await this.builder.saveAllPromotion.saveCatalogs(promotionCatalogs);
    let success = 0;
    let failure = 0;
    let skipped = 0;

    for (const promotionCatalog of promotionCatalogs) {
      if (this.hasFutureStartDate(promotionCatalog)) {
        skipped += 1;
        Logger.info(
          JSON.stringify({
            message: 'Promotion sync skipped because start date has not been reached',
            process: processName,
            sourceProcess: input.sourceProcess,
            updatedBy: input.updatedBy,
            promotionId: promotionCatalog.promotionId,
            promotionType: promotionCatalog.type,
            startDate: promotionCatalog.startDate?.toISOString() ?? null,
            currentDate: new Date().toISOString(),
          }),
        );
        continue;
      }

      let searchAfter: string | undefined;

      do {
        const currentSearchAfter = searchAfter;
        const response = await this.builder.mercadolibreApiRepository.getElegibleItemsPaginated(
          promotionCatalog.promotionId,
          promotionCatalog.type,
          currentSearchAfter,
        );

        const consolidated: Promotion[] = [];
        const eligibleItems = response.results ?? [];
        const nextSearchAfter = response.paging?.searchAfter;

        if (eligibleItems.length === 0) {
          break;
        }

        const mlas = eligibleItems.map((item) => item.itemId);
        const existingMlasResult = await this.resolveExistingMlas({
          promotionCatalog,
          eligibleItems,
          input,
          processName,
        });
        failure += existingMlasResult.failureCount;
        const existingMlas = existingMlasResult.existingMlas;

        const enabledEligibleItems = eligibleItems.filter((item) => existingMlas.has(item.itemId));
        const buildCommands: PromotionBuilderInput[] = [];
        for (const item of enabledEligibleItems) {
          try {
            const detail = await this.builder.mercadolibreApiRepository.getItemDetail(item.itemId);
            if (!detail.categoryId) {
              throw new Error(`Missing categoryId for item ${item.itemId}`);
            }

            buildCommands.push({
              promotionCatalog,
              eligibleItem: item,
              itemDetail: detail,
              input,
            });
          } catch (error) {
            failure += 1;
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            await this.persistFailedSyncPromotion({
              promotionCatalog,
              eligibleItem: item,
              input,
              reason: message,
            });
            Logger.error(
              JSON.stringify({
                message: 'Promotion sync item failed',
                process: processName,
                sourceProcess: input.sourceProcess,
                itemId: item.itemId,
                promotionId: promotionCatalog.promotionId,
                reason: message,
              }),
            );
          }
        }

        const metricsRequests: PriceMetricsRequest<PromotionBuilderInput>[] = buildCommands.map(
          (command) => ({
            context: command,
            input: {
              itemId: command.eligibleItem.itemId,
              sku: command.itemDetail.sku,
              categoryId: command.itemDetail.categoryId,
              publicationType: command.itemDetail.listingTypeId,
              salePrice: command.eligibleItem.suggestedPrice ?? command.itemDetail.price ?? 0,
              meliContributionPercentage: command.eligibleItem.meliPercentage,
            },
          }),
        );

        const resolvedMetrics = await this.priceMetricsResolver.resolve(metricsRequests);

        for (const resolved of resolvedMetrics) {
          try {
            if (resolved.error) {
              throw resolved.error;
            }

            const promotion = await this.buildPromotion({
              ...resolved.context,
              priceMetrics: resolved.metrics,
            });
            consolidated.push(promotion);
          } catch (error) {
            failure += 1;
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            await this.persistFailedSyncPromotion({
              promotionCatalog,
              eligibleItem: resolved.context.eligibleItem,
              itemDetail: resolved.context.itemDetail,
              input,
              reason: message,
            });
            Logger.error(
              JSON.stringify({
                message: 'Promotion sync item failed',
                process: processName,
                sourceProcess: input.sourceProcess,
                itemId: resolved.context.eligibleItem.itemId,
                promotionId: promotionCatalog.promotionId,
                reason: message,
              }),
            );
          }
        }

        if (consolidated.length > 0) {
          await this.builder.saveAllPromotion.saveAll(consolidated);
          success += consolidated.length;

          for (const promotion of consolidated) {
            Logger.info(
              JSON.stringify({
                message: 'Promotion synced',
                process: processName,
                sourceProcess: input.sourceProcess,
                updatedBy: input.updatedBy,
                promotionId: promotion.promotionId,
                itemId: promotion.itemId,
                status: promotion.status,
              }),
            );
          }
        }

        console.log(
          `Processed promotion ${promotionCatalog.promotionId} page, success: ${success}, failure: ${failure}`,
        );

        if (!nextSearchAfter || nextSearchAfter === currentSearchAfter) {
          if (nextSearchAfter === currentSearchAfter) {
            Logger.warn(
              JSON.stringify({
                message: 'Stopping promotion sync pagination because searchAfter did not advance',
                process: processName,
                sourceProcess: input.sourceProcess,
                promotionId: promotionCatalog.promotionId,
                promotionType: promotionCatalog.type,
                searchAfter: currentSearchAfter ?? null,
              }),
            );
          }
          break;
        }

        searchAfter = nextSearchAfter;
      } while (searchAfter);
    }

    return {
      process: processName,
      total: success + failure + skipped,
      success,
      failure,
      skipped,
    };
  }

  private async buildPromotion(command: PromotionBuilderInput): Promise<Promotion> {
    const promotionBuilder = this.promotionModelsRegistry.resolve(command.promotionCatalog.type);
    return promotionBuilder.build(command);
  }

  private async persistFailedSyncPromotion(params: {
    promotionCatalog: PromotionCatalog;
    eligibleItem: EligibleItem;
    input: SyncAllPromotionsInput;
    reason: string;
    itemDetail?: ItemDetail;
  }): Promise<void> {
    const now = new Date();
    const failedPromotion: Promotion = {
      itemId: params.eligibleItem.itemId,
      promotionId: params.promotionCatalog.promotionId,
      name: params.promotionCatalog.name,
      type: params.promotionCatalog.type,
      startDate: params.promotionCatalog.startDate,
      finishDate: params.promotionCatalog.finishDate,
      deadlineDate: params.promotionCatalog.deadlineDate,
      status: PromotionStatus.FAILED_SYNC,
      offerId: params.eligibleItem.offerId,
      sku: params.itemDetail?.sku ?? '',
      categoryId: params.itemDetail?.categoryId ?? 'UNKNOWN',
      listingTypeId: params.itemDetail?.listingTypeId ?? '',
      prices: {
        originalPrice: params.eligibleItem.originalPrice,
        minPrice: params.eligibleItem.minPrice,
        maxPrice: params.eligibleItem.maxPrice,
        suggestedPrice: params.eligibleItem.suggestedPrice,
      },
      economics: {},
      metadata: {
        syncedAt: now,
        updatedBy: params.input.updatedBy,
        sourceProcess: params.input.sourceProcess,
        reason: params.reason,
        statusReason: params.reason,
      },
      auditTrail: [
        {
          process: params.input.sourceProcess,
          status: PromotionStatus.FAILED_SYNC,
          executedAt: now,
          reason: params.reason,
        },
      ],
    };

    await this.builder.saveAllPromotion.saveAll([failedPromotion]);
  }

  private async resolveExistingMlas(params: {
    promotionCatalog: PromotionCatalog;
    eligibleItems: EligibleItem[];
    input: SyncAllPromotionsInput;
    processName: string;
  }): Promise<{ existingMlas: Set<string>; failureCount: number }> {
    const existingMlas = new Set<string>();
    let failureCount = 0;
    const eligibleItemChunks = this.chunkArray(
      params.eligibleItems,
      SyncAllPromotions.CAMPAIGN_EXISTS_BULK_LIMIT,
    );

    for (const chunk of eligibleItemChunks) {
      try {
        const response = await this.builder.campaignMlaApiRepository.existsBulk(
          chunk.map((item) => item.itemId),
        );
        const existingItems = new Map(
          (response.items ?? []).map((item) => [item.mla, item.exists]),
        );

        for (const eligibleItem of chunk) {
          if (existingItems.get(eligibleItem.itemId) === true) {
            existingMlas.add(eligibleItem.itemId);
            continue;
          }

          const reason = existingItems.has(eligibleItem.itemId)
            ? 'Item is not present in Madre campaign repository'
            : 'Item was not returned by Madre campaign repository';

          await this.persistFailedSyncPromotion({
            promotionCatalog: params.promotionCatalog,
            eligibleItem,
            input: params.input,
            reason,
          });
          failureCount += 1;

          Logger.error(
            JSON.stringify({
              message: 'Promotion sync item failed',
              process: params.processName,
              sourceProcess: params.input.sourceProcess,
              itemId: eligibleItem.itemId,
              promotionId: params.promotionCatalog.promotionId,
              reason,
            }),
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown campaign mla sync error';

        for (const eligibleItem of chunk) {
          await this.persistFailedSyncPromotion({
            promotionCatalog: params.promotionCatalog,
            eligibleItem,
            input: params.input,
            reason,
          });
          failureCount += 1;

          Logger.error(
            JSON.stringify({
              message: 'Promotion sync item failed',
              process: params.processName,
              sourceProcess: params.input.sourceProcess,
              itemId: eligibleItem.itemId,
              promotionId: params.promotionCatalog.promotionId,
              reason,
            }),
          );
        }
      }
    }

    return { existingMlas, failureCount };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private hasFutureStartDate(promotionCatalog: PromotionCatalog): boolean {
    if (!promotionCatalog.startDate) {
      return false;
    }

    return promotionCatalog.startDate > new Date();
  }
}
