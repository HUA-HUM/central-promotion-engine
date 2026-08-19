import { AppConfig } from '@app/drivers/config/AppConfig';
import { IAPICampaignMlaApiRepository } from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import {
  EligibleItem,
  IAPIMercadolibreApiRepository,
  ItemDetail,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
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
import { DealPriceControlService } from '@core/interactors/promotion/services/DealPriceControlService';
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
  dealPriceControlService?: DealPriceControlService;
  promotionRepository?: PromotionRepository;
}

export class SyncAllPromotions {
  private static readonly CAMPAIGN_EXISTS_BULK_LIMIT = 50;
  private static readonly ITEM_DETAIL_CONCURRENCY = 10;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;

  constructor(private readonly builder: SyncAllPromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
    this.promotionModelsRegistry = PromotionModelsRegistry.forSync(
      builder.priceApiRepository,
      builder.dealPriceControlService,
    );
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

      const promotionModel = this.promotionModelsRegistry.resolve(promotionCatalog.type);
      let searchAfter: string | undefined;

      do {
        const currentSearchAfter = searchAfter;
        const response = await this.builder.mercadolibreApiRepository.getElegibleItemsPaginated(
          promotionCatalog.promotionId,
          promotionCatalog.type,
          currentSearchAfter,
        );

        const consolidated: Promotion[] = [];
        const failedPromotions: Promotion[] = [];
        const eligibleItems = response.results ?? [];
        const nextSearchAfter = response.paging?.searchAfter;

        if (eligibleItems.length === 0) {
          break;
        }

        const existingMlasResult = await this.resolveExistingMlas({
          promotionCatalog,
          eligibleItems,
          input,
          processName,
          failedPromotions,
        });
        failure += existingMlasResult.failureCount;
        const existingMlas = existingMlasResult.existingMlas;

        const enabledEligibleItems = eligibleItems.filter((item) => existingMlas.has(item.itemId));
        const buildCommands: PromotionBuilderInput[] = [];

        const detailResults = await this.mapWithConcurrency(
          enabledEligibleItems,
          SyncAllPromotions.ITEM_DETAIL_CONCURRENCY,
          async (item) => {
            const detail = await this.builder.mercadolibreApiRepository.getItemDetail(item.itemId);
            if (!detail.categoryId) {
              throw new Error(`Missing categoryId for item ${item.itemId}`);
            }

            return {
              eligibleItem: item,
              itemDetail: detail,
            };
          },
        );

        for (const detailResult of detailResults) {
          if (detailResult.status === 'fulfilled') {
            buildCommands.push({
              promotionCatalog,
              eligibleItem: detailResult.item.eligibleItem,
              itemDetail: detailResult.item.itemDetail,
              input,
            });
            continue;
          }

          failure += 1;
          const message = detailResult.error.message;
          failedPromotions.push(
            this.buildFailedSyncPromotion({
              promotionCatalog,
              eligibleItem: detailResult.item,
              input,
              reason: message,
            }),
          );
          Logger.error(
            JSON.stringify({
              message: 'Promotion sync item failed',
              process: processName,
              sourceProcess: input.sourceProcess,
              itemId: detailResult.item.itemId,
              promotionId: promotionCatalog.promotionId,
              reason: message,
            }),
          );
        }

        const metricsRequests: PriceMetricsRequest<PromotionBuilderInput>[] = buildCommands.map(
          (command) => ({
            context: command,
            input: {
              itemId: command.eligibleItem.itemId,
              sku: command.itemDetail.sku,
              categoryId: command.itemDetail.categoryId,
              publicationType: command.itemDetail.listingTypeId,
              salePrice: promotionModel.resolveSyncSalePrice(command.eligibleItem, command.itemDetail),
              meliContributionPercentage: command.eligibleItem.meliPercentage,
            },
          }),
        );

        let existingPromotionsByItemId = new Map<string, Promotion>();
        if (promotionModel.applyPriceControl && this.builder.promotionRepository && buildCommands.length > 0) {
          const existingPromotions = await this.builder.promotionRepository.findByItemIds(
            promotionCatalog.promotionId,
            buildCommands.map((command) => command.eligibleItem.itemId),
          );
          existingPromotionsByItemId = new Map(
            existingPromotions.map((promotion) => [promotion.itemId, promotion]),
          );
        }

        const resolvedMetrics = await this.priceMetricsResolver.resolve(metricsRequests);

        for (const resolved of resolvedMetrics) {
          try {
            if (resolved.error) {
              throw resolved.error;
            }

            let promotion = await promotionModel.build({
              ...resolved.context,
              priceMetrics: resolved.metrics,
            });

            if (promotionModel.applyPriceControl) {
              const metrics = resolved.metrics;
              if (!metrics) {
                throw new Error(`Missing price metrics for item ${resolved.context.eligibleItem.itemId}`);
              }

              promotion = await promotionModel.applyPriceControl({
                promotion,
                context: resolved.context,
                metrics,
                existingPromotion: existingPromotionsByItemId.get(resolved.context.eligibleItem.itemId),
              });
            }

            consolidated.push(promotion);
          } catch (error) {
            failure += 1;
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            failedPromotions.push(
              this.buildFailedSyncPromotion({
                promotionCatalog,
                eligibleItem: resolved.context.eligibleItem,
                itemDetail: resolved.context.itemDetail,
                input,
                reason: message,
              }),
            );
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

        if (failedPromotions.length > 0) {
          await this.persistFailedSyncPromotions(failedPromotions);
        }

        if (consolidated.length > 0) {
          await this.builder.saveAllPromotion.saveAll(consolidated);
          success += consolidated.length;
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

  private buildFailedSyncPromotion(params: {
    promotionCatalog: PromotionCatalog;
    eligibleItem: EligibleItem;
    input: SyncAllPromotionsInput;
    reason: string;
    itemDetail?: ItemDetail;
  }): Promotion {
    const now = new Date();
    return {
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
  }

  private async persistFailedSyncPromotions(promotions: Promotion[]): Promise<void> {
    if (promotions.length === 0) {
      return;
    }

    await this.builder.saveAllPromotion.saveAll(promotions);
  }

  private async resolveExistingMlas(params: {
    promotionCatalog: PromotionCatalog;
    eligibleItems: EligibleItem[];
    input: SyncAllPromotionsInput;
    processName: string;
    failedPromotions: Promotion[];
  }): Promise<{ existingMlas: Set<string>; failureCount: number }> {
    // Deprecated temporarily:
    // We are skipping Madre `campaign-mlas/exists/bulk` validation for sync because
    // transient timeouts there are generating large batches of FAILED_SYNC items.
    // Keep the old implementation commented here for an easy rollback once Madre
    // becomes stable again.
    //
    // const existingMlas = new Set<string>();
    // let failureCount = 0;
    // const eligibleItemChunks = this.chunkArray(
    //   params.eligibleItems,
    //   SyncAllPromotions.CAMPAIGN_EXISTS_BULK_LIMIT,
    // );
    //
    // for (const chunk of eligibleItemChunks) {
    //   try {
    //     const response = await this.builder.campaignMlaApiRepository.existsBulk(
    //       chunk.map((item) => item.itemId),
    //     );
    //     const existingItems = new Map(
    //       (response.items ?? []).map((item) => [item.mla, item.exists]),
    //     );
    //
    //     for (const eligibleItem of chunk) {
    //       if (existingItems.get(eligibleItem.itemId) === true) {
    //         existingMlas.add(eligibleItem.itemId);
    //         continue;
    //       }
    //
    //       const reason = existingItems.has(eligibleItem.itemId)
    //         ? 'Item is not present in Madre campaign repository'
    //         : 'Item was not returned by Madre campaign repository';
    //
    //       params.failedPromotions.push(
    //         this.buildFailedSyncPromotion({
    //           promotionCatalog: params.promotionCatalog,
    //           eligibleItem,
    //           input: params.input,
    //           reason,
    //         }),
    //       );
    //       failureCount += 1;
    //
    //       Logger.error(
    //         JSON.stringify({
    //           message: 'Promotion sync item failed',
    //           process: params.processName,
    //           sourceProcess: params.input.sourceProcess,
    //           itemId: eligibleItem.itemId,
    //           promotionId: params.promotionCatalog.promotionId,
    //           reason,
    //         }),
    //       );
    //     }
    //   } catch (error) {
    //     const reason = error instanceof Error ? error.message : 'Unknown campaign mla sync error';
    //
    //     for (const eligibleItem of chunk) {
    //       params.failedPromotions.push(
    //         this.buildFailedSyncPromotion({
    //           promotionCatalog: params.promotionCatalog,
    //           eligibleItem,
    //           input: params.input,
    //           reason,
    //         }),
    //       );
    //       failureCount += 1;
    //
    //       Logger.error(
    //         JSON.stringify({
    //           message: 'Promotion sync item failed',
    //           process: params.processName,
    //           sourceProcess: params.input.sourceProcess,
    //           itemId: eligibleItem.itemId,
    //           promotionId: params.promotionCatalog.promotionId,
    //           reason,
    //         }),
    //       );
    //     }
    //   }
    // }
    //
    // return { existingMlas, failureCount };

    return {
      existingMlas: new Set(params.eligibleItems.map((item) => item.itemId)),
      failureCount: 0,
    };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private async mapWithConcurrency<TItem, TResult>(
    items: TItem[],
    concurrency: number,
    mapper: (item: TItem) => Promise<TResult>,
  ): Promise<
    Array<
      | { status: 'fulfilled'; item: TResult }
      | { status: 'rejected'; item: TItem; error: Error }
    >
  > {
    const results: Array<
      | { status: 'fulfilled'; item: TResult }
      | { status: 'rejected'; item: TItem; error: Error }
    > = new Array(items.length);
    let currentIndex = 0;

    const worker = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex;
        currentIndex += 1;
        const item = items[index];

        try {
          results[index] = {
            status: 'fulfilled',
            item: await mapper(item),
          };
        } catch (error) {
          results[index] = {
            status: 'rejected',
            item,
            error: error instanceof Error ? error : new Error('Unknown async mapping error'),
          };
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    );

    await Promise.all(workers);

    return results;
  }

  private hasFutureStartDate(promotionCatalog: PromotionCatalog): boolean {
    if (!promotionCatalog.startDate) {
      return false;
    }

    return promotionCatalog.startDate > new Date();
  }
}
