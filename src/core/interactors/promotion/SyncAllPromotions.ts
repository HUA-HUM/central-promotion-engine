import { AppConfig } from '@app/drivers/config/AppConfig';
import { IAPICampaignMlaApiRepository } from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import {
  EligibleItem,
  IAPIMercadolibreApiRepository,
  ItemDetail,
  MeliPaginatedResponse,
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
import { mapWithConcurrency } from '@core/interactors/promotion/mapWithConcurrency';
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
  private static readonly ITEM_DETAIL_BULK_LIMIT = 20;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;

  constructor(private readonly builder: SyncAllPromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
    this.promotionModelsRegistry = PromotionModelsRegistry.forSync(
      builder.priceApiRepository,
      builder.dealPriceControlService,
      builder.config.metricsLoggingEnabled,
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
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const durationMinutes = Number((durationMs / 60000).toFixed(2));
    const itemsPerSecond = Number((result.total / (durationMs / 1000)).toFixed(2));

    Logger.info(
      JSON.stringify({
        message: 'Promotion sync process finished',
        process: result.process,
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMinutes,
        itemsPerSecond,
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

    const concurrency = Math.max(1, this.builder.config.syncPromotionConcurrency || 1);
    const catalogResults = await mapWithConcurrency(promotionCatalogs, concurrency, (promotionCatalog) =>
      this.syncOnePromotionCatalog(promotionCatalog, input, processName),
    );

    const totals = catalogResults.reduce(
      (acc, result) => ({
        success: acc.success + result.success,
        failure: acc.failure + result.failure,
        skipped: acc.skipped + result.skipped,
      }),
      { success: 0, failure: 0, skipped: 0 },
    );

    return {
      process: processName,
      total: totals.success + totals.failure + totals.skipped,
      success: totals.success,
      failure: totals.failure,
      skipped: totals.skipped,
    };
  }

  private async syncOnePromotionCatalog(
    promotionCatalog: PromotionCatalog,
    input: SyncAllPromotionsInput,
    processName: string,
  ): Promise<{ success: number; failure: number; skipped: number }> {
    if (this.hasFutureStartDate(promotionCatalog)) {
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
      return { success: 0, failure: 0, skipped: 1 };
    }

    let success = 0;
    let failure = 0;
    const skipped = 0;

    try {
      const promotionModel = this.promotionModelsRegistry.resolve(promotionCatalog.type);
      let currentSearchAfter: string | undefined;
      let pendingPage: Promise<MeliPaginatedResponse<EligibleItem>> | null =
        this.startEligibleItemsPageFetch(promotionCatalog, currentSearchAfter);

      while (pendingPage) {
        const pagePromise: Promise<MeliPaginatedResponse<EligibleItem>> = pendingPage;
        const pageStartedAt = Date.now();
        const eligibleItemsFetchStartedAt = Date.now();
        const response: MeliPaginatedResponse<EligibleItem> = await pagePromise;
        const eligibleItemsFetchDurationMs = Date.now() - eligibleItemsFetchStartedAt;

        const consolidated: Promotion[] = [];
        const failedPromotions: Promotion[] = [];
        const eligibleItems: EligibleItem[] = response.results ?? [];
        const nextSearchAfter: string | undefined = response.paging?.searchAfter;

        pendingPage =
          eligibleItems.length > 0 && nextSearchAfter && nextSearchAfter !== currentSearchAfter
            ? this.startEligibleItemsPageFetch(promotionCatalog, nextSearchAfter)
            : null;

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

        const itemDetailFetchStartedAt = Date.now();
        const itemDetails = await this.builder.mercadolibreApiRepository.getItemDetailsBulk(
          enabledEligibleItems.map((item) => item.itemId),
        );
        const itemDetailFetchDurationMs = Date.now() - itemDetailFetchStartedAt;
        const itemDetailByItemId = new Map(itemDetails.map((detail) => [detail.itemId, detail]));

        for (const item of enabledEligibleItems) {
          const detail = itemDetailByItemId.get(item.itemId);

          if (detail && detail.categoryId) {
            buildCommands.push({
              promotionCatalog,
              eligibleItem: item,
              itemDetail: detail,
              input,
            });
            continue;
          }

          failure += 1;
          const message = detail
            ? `Missing categoryId for item ${item.itemId}`
            : `Item detail not returned by Mercado Libre bulk endpoint for item ${item.itemId}`;
          failedPromotions.push(
            this.buildFailedSyncPromotion({
              promotionCatalog,
              eligibleItem: item,
              input,
              reason: message,
            }),
          );
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

        const priceMetricsResolveStartedAt = Date.now();
        const { results: resolvedMetrics, stats: priceMetricsStats } =
          await this.priceMetricsResolver.resolve(metricsRequests);
        const priceMetricsResolveDurationMs = Date.now() - priceMetricsResolveStartedAt;

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

        const saveStartedAt = Date.now();
        if (failedPromotions.length > 0) {
          await this.persistFailedSyncPromotions(failedPromotions);
        }

        if (consolidated.length > 0) {
          await this.builder.saveAllPromotion.saveAll(consolidated);
          success += consolidated.length;
        }
        const saveDurationMs = Date.now() - saveStartedAt;

        const pageDurationMs = Date.now() - pageStartedAt;
        const meliApiCallCount =
          1 +
          (enabledEligibleItems.length > 0
            ? Math.ceil(enabledEligibleItems.length / SyncAllPromotions.ITEM_DETAIL_BULK_LIMIT)
            : 0);
        const priceApiCallCount = priceMetricsStats.bulkCallCount + priceMetricsStats.individualFallbackCount;
        Logger.info(
          JSON.stringify({
            message: 'Promotion sync page processed',
            process: processName,
            sourceProcess: input.sourceProcess,
            promotionId: promotionCatalog.promotionId,
            promotionType: promotionCatalog.type,
            pageItemCount: eligibleItems.length,
            pageDurationMs,
            eligibleItemsFetchDurationMs,
            itemDetailFetchDurationMs,
            priceMetricsResolveDurationMs,
            saveDurationMs,
            meliApiCallCount,
            priceApiCallCount,
            success,
            failure,
          }),
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

        currentSearchAfter = nextSearchAfter;
      }
    } catch (error) {
      failure += 1;
      Logger.error(
        JSON.stringify({
          message: 'Promotion sync failed for promotion catalog',
          process: processName,
          sourceProcess: input.sourceProcess,
          promotionId: promotionCatalog.promotionId,
          promotionType: promotionCatalog.type,
          reason: error instanceof Error ? error.message : 'Unknown sync error',
        }),
      );
    }

    return { success, failure, skipped };
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

  private startEligibleItemsPageFetch(
    promotionCatalog: PromotionCatalog,
    searchAfter: string | undefined,
  ): Promise<MeliPaginatedResponse<EligibleItem>> {
    const pagePromise = this.builder.mercadolibreApiRepository.getElegibleItemsPaginated(
      promotionCatalog.promotionId,
      promotionCatalog.type,
      searchAfter,
    );
    void pagePromise.catch(() => undefined);

    return pagePromise;
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
