import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { IAPICatalogMeliApiRepository } from '@core/adapters/repositories/catalog-meli/IAPICatalogMeliApiRepository';
import { IAPICampaignMlaApiRepository } from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import { IAPIMercadolibreApiRepository } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { IAPIPriceApiRepository } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { mapWithConcurrency } from '@core/interactors/promotion/mapWithConcurrency';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';
import {
  PriceMetricsBulkResolver,
  PriceMetricsRequest,
} from '@core/interactors/promotion/services/PriceMetricsBulkResolver';
import { DealPriceControlService } from '@core/interactors/promotion/services/DealPriceControlService';
import { ItemDetailResolver } from '@core/interactors/promotion/services/ItemDetailResolver';

interface PromotionMetricsCandidate {
  promotion: Promotion;
  detail: {
    categoryId: string;
    listingTypeId: string;
    sku?: string;
    salePrice: number;
    sellerPercentage?: number;
    meliContributionPercentage?: number;
  };
}

export interface DeactivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface DeactivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  campaignMlaApiRepository: IAPICampaignMlaApiRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  priceApiRepository: IAPIPriceApiRepository;
  dealPriceControlService: DealPriceControlService;
  config: AppConfig;
  catalogMeliApiRepository?: IAPICatalogMeliApiRepository;
}

export class DeactivatePromotions {
  private static readonly BATCH_SIZE = 500;
  private static readonly CAMPAIGN_EXISTS_BULK_LIMIT = 100;
  private static readonly DEACTIVATION_CONCURRENCY = 10;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;
  private readonly itemDetailResolver: ItemDetailResolver;

  constructor(private readonly builder: DeactivatePromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
    this.promotionModelsRegistry = PromotionModelsRegistry.forActivation();
    this.itemDetailResolver = new ItemDetailResolver({
      mercadolibreApiRepository: builder.mercadolibreApiRepository,
      catalogMeliApiRepository: builder.catalogMeliApiRepository,
      enabled: builder.config.catalogMeliApiEnabled,
    });
  }

  async execute(input: DeactivatePromotionsInput): Promise<ProcessResult> {
    return this.executeWithBatchFetcher(
      input,
      (afterId) =>
        this.builder.promotionRepository.findActiveBatch(
          afterId,
          DeactivatePromotions.BATCH_SIZE,
        ),
      'Promotion deactivation process started',
      'Promotion deactivation process finished',
      'deactivate',
    );
  }

  async retryFailed(input: DeactivatePromotionsInput): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: 'Failed promotion deactivation retry process started',
        process: 'deactivate-failed',
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
      }),
    );

    let success = 0;
    let failure = 0;
    let skipped = 0;
    let total = 0;
    let lastProcessedId: string | undefined;

    while (true) {
      const promotions = await this.builder.promotionRepository.findFailedDeactivationBatch(
        lastProcessedId,
        DeactivatePromotions.BATCH_SIZE,
      );

      if (promotions.length === 0) {
        break;
      }

      total += promotions.length;
      lastProcessedId = this.resolveLastProcessedId(promotions, lastProcessedId);

      const results = await mapWithConcurrency(
        promotions,
        DeactivatePromotions.DEACTIVATION_CONCURRENCY,
        async (promotion) => this.retryFailedPromotion(promotion, input),
      );

      for (const result of results) {
        if (result === 'success') {
          success += 1;
          continue;
        }

        if (result === 'failure') {
          failure += 1;
          continue;
        }

        skipped += 1;
      }
    }

    const processResult: ProcessResult = {
      process: 'deactivate-failed',
      total,
      success,
      failure,
      skipped,
    };

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const durationMinutes = Number((durationMs / 60000).toFixed(2));
    const itemsPerSecond = Number((processResult.total / (durationMs / 1000)).toFixed(2));

    Logger.info(
      JSON.stringify({
        message: 'Failed promotion deactivation retry process finished',
        process: processResult.process,
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMinutes,
        itemsPerSecond,
        total: processResult.total,
        success: processResult.success,
        failure: processResult.failure,
        skipped: processResult.skipped,
      }),
    );

    return processResult;
  }

  private async executeWithBatchFetcher(
    input: DeactivatePromotionsInput,
    batchFetcher: (afterId?: string) => Promise<Promotion[]>,
    startedMessage: string,
    finishedMessage: string,
    processName: ProcessResult['process'],
  ): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: startedMessage,
        process: processName,
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
      }),
    );

    let success = 0;
    let failure = 0;
    let skipped = 0;
    let total = 0;
    let lastProcessedId: string | undefined;

    while (true) {
      const promotions = await batchFetcher(lastProcessedId);

      if (promotions.length === 0) {
        break;
      }

      total += promotions.length;
      lastProcessedId = this.resolveLastProcessedId(promotions, lastProcessedId);

      const activeMlas = promotions.map((promotion) => promotion.itemId);
      // Deprecated temporarily:
      // We are skipping Madre `campaign-mlas/exists/bulk` validation for deactivate
      // because transient timeouts there are interrupting valid profitability rechecks.
      // Keep the old implementation commented here for an easy rollback.
      //
      // const existingMlasResponse = activeMlas.length
      //   ? await this.fetchExistingMlas(activeMlas)
      //   : { items: [], total: 0 };
      // const existingMlas = new Set(
      //   (existingMlasResponse.items ?? [])
      //     .filter((item) => item.exists)
      //     .map((item) => item.mla),
      // );
      const existingMlas = new Set(activeMlas);

      const metricsCandidates: PromotionMetricsCandidate[] = [];

      for (const promotion of promotions) {
        const batchPreparationResult = await this.preparePromotion(promotion, existingMlas, input);

        if (batchPreparationResult.kind === 'candidate') {
          metricsCandidates.push(batchPreparationResult.candidate);
          continue;
        }

        if (batchPreparationResult.kind === 'success') {
          success += 1;
          continue;
        }

        if (batchPreparationResult.kind === 'failure') {
          failure += 1;
          continue;
        }

        if (batchPreparationResult.kind === 'skipped') {
          skipped += 1;
          continue;
        }
      }

      const metricsRequests: PriceMetricsRequest<PromotionMetricsCandidate>[] = metricsCandidates.map(
        (candidate) => ({
          context: candidate,
          input: {
            itemId: candidate.promotion.itemId,
            sku: candidate.detail.sku,
            categoryId: candidate.detail.categoryId,
            publicationType: candidate.detail.listingTypeId,
            salePrice: candidate.detail.salePrice,
            meliContributionPercentage: candidate.detail.meliContributionPercentage,
          },
        }),
      );

      const { results: resolvedMetrics } = await this.priceMetricsResolver.resolve(metricsRequests);

      const metricsResults = await mapWithConcurrency(
        resolvedMetrics,
        DeactivatePromotions.DEACTIVATION_CONCURRENCY,
        async (resolved) => this.processResolvedMetrics(resolved.context, resolved.metrics, resolved.error, input),
      );

      for (const metricsResult of metricsResults) {
        if (metricsResult === 'success') {
          success += 1;
          continue;
        }

        if (metricsResult === 'failure') {
          failure += 1;
          continue;
        }

        skipped += 1;
      }
    }

    const result: ProcessResult = {
      process: processName,
      total,
      success,
      failure,
      skipped,
    };

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const durationMinutes = Number((durationMs / 60000).toFixed(2));
    const itemsPerSecond = Number((result.total / (durationMs / 1000)).toFixed(2));

    Logger.info(
      JSON.stringify({
        message: finishedMessage,
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

  private async markAs(
    promotion: Promotion,
    status: PromotionStatus.DELETED | PromotionStatus.FINISHED,
    input: DeactivatePromotionsInput,
    reason: string,
    statusReason: string,
  ): Promise<void> {
    await this.builder.promotionRepository.update({
      ...promotion,
      status,
      metadata: {
        ...promotion.metadata,
        deactivatedAt: new Date(),
        updatedBy: input.updatedBy,
        sourceProcess: input.sourceProcess,
        reason,
        statusReason,
      },
      auditTrail: [
        ...promotion.auditTrail,
        {
          process: input.sourceProcess,
          status,
          reason,
          executedAt: new Date(),
        },
      ],
    });
  }

  private async finishExpiredDeal(
    promotion: Promotion,
    input: DeactivatePromotionsInput,
  ): Promise<void> {
    const releasedPriceControl = await this.builder.dealPriceControlService.release(promotion);

    const now = new Date();
    const reason = 'Promotion is outside valid date range';

    await this.builder.promotionRepository.update({
      ...promotion,
      status: PromotionStatus.FINISHED,
      priceControl: releasedPriceControl,
      metadata: {
        ...promotion.metadata,
        deactivatedAt: now,
        updatedBy: input.updatedBy,
        sourceProcess: input.sourceProcess,
        reason,
        statusReason: 'DEAL promotion finished automatically because it is outside valid date range',
      },
      auditTrail: [
        ...promotion.auditTrail,
        {
          process: input.sourceProcess,
          status: PromotionStatus.FINISHED,
          reason,
          executedAt: now,
        },
      ],
    });

    Logger.info(
      JSON.stringify({
        message: 'DEAL promotion finished automatically and Automeli released',
        process: 'deactivate',
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        promotionId: promotion.promotionId,
        itemId: promotion.itemId,
        automeliReleased: releasedPriceControl?.status === 'RELEASED',
        priceControlStatus: releasedPriceControl?.status,
      }),
    );
  }

  private buildPromotionWithUpdatedMetrics(
    promotion: Promotion,
    currentSalePrice: number,
    currentMetrics: Awaited<ReturnType<IAPIPriceApiRepository['getMetrics']>>,
    input: DeactivatePromotionsInput,
  ): Promotion {
    const revalidatedAt = new Date();

    return {
      ...promotion,
      prices: {
        ...promotion.prices,
        ...(promotion.type === PromotionType.DEAL
          ? { maxPrice: currentSalePrice }
          : { suggestedPrice: currentSalePrice }),
      },
      economics: {
        ...promotion.economics,
        cost: currentMetrics.cost ?? promotion.economics.cost,
        profit: currentMetrics.profit ?? promotion.economics.profit,
        profitability: currentMetrics.profitability ?? promotion.economics.profitability,
        margin: currentMetrics.margin ?? promotion.economics.margin,
        profitable: currentMetrics.profitable ?? promotion.economics.profitable,
        shouldPause: currentMetrics.shouldPause ?? promotion.economics.shouldPause,
      },
      metadata: {
        ...promotion.metadata,
        updatedBy: input.updatedBy,
        sourceProcess: input.sourceProcess,
        reason: undefined,
        statusReason: 'Promotion revalidated and kept active',
      },
      auditTrail: [
        ...promotion.auditTrail,
        {
          process: input.sourceProcess,
          status: PromotionStatus.ACTIVE,
          reason: 'Promotion revalidated and kept active',
          executedAt: revalidatedAt,
        },
      ],
    };
  }

  private async deleteOrPauseAndMark(
    promotion: Promotion,
    input: DeactivatePromotionsInput,
    reason: string,
    statusReasonSuffix: string,
  ): Promise<void> {
    const action = promotion.offerId ? 'pause' : 'delete';
    const command = this.promotionModelsRegistry
      .resolve(promotion.type)
      .buildDeactivationCommand(promotion, action);

    await this.builder.mercadolibreApiRepository.pauseOrDeletePromotion(command);

    await this.markAs(
      promotion,
      PromotionStatus.DELETED,
      input,
      reason,
      `Promotion ${action} ${statusReasonSuffix}`,
    );

    Logger.info(
      JSON.stringify({
        message: 'Promotion deactivated',
        process: 'deactivate',
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        promotionId: promotion.promotionId,
        itemId: promotion.itemId,
        promotionType: promotion.type,
        action,
        reason,
      }),
    );
  }

  private async markAsFailed(
    promotion: Promotion,
    input: DeactivatePromotionsInput,
    error: unknown,
  ): Promise<void> {
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
        promotionId: promotion.promotionId,
        itemId: promotion.itemId,
        reason,
      }),
    );
  }

  private async preparePromotion(
    promotion: Promotion,
    existingMlas: Set<string>,
    input: DeactivatePromotionsInput,
  ): Promise<
    | { kind: 'candidate'; candidate: PromotionMetricsCandidate }
    | { kind: 'success' }
    | { kind: 'failure' }
    | { kind: 'skipped' }
  > {
    try {
      if (promotion.type === PromotionType.DEAL) {
        if (this.isPromotionOutOfDate(promotion)) {
          await this.finishExpiredDeal(promotion, input);
          return { kind: 'success' };
        }

        Logger.info(
          JSON.stringify({
            message: 'Skipping DEAL deactivation because DEAL promotions require manual deactivation',
            process: 'deactivate',
            sourceProcess: input.sourceProcess,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            updatedBy: input.updatedBy,
          }),
        );

        return { kind: 'skipped' };
      }

      if (this.isPromotionOutOfDate(promotion)) {
        await this.markAs(
          promotion,
          PromotionStatus.FINISHED,
          input,
          'Promotion is outside valid date range',
          'Promotion finished automatically because it is outside valid date range',
        );
        return { kind: 'success' };
      }

      if (!existingMlas.has(promotion.itemId)) {
        await this.deleteOrPauseAndMark(
          promotion,
          input,
          'Promotion item no longer exists in campaign repository',
          'because item is not in campaign repository',
        );
        return { kind: 'success' };
      }

      const categoryId = promotion.categoryId;
      if (!categoryId) {
        throw new Error(`Missing categoryId for item ${promotion.itemId}`);
      }

      const listingTypeId = promotion.listingTypeId;
      if (!listingTypeId) {
        throw new Error(`Missing listingTypeId for item ${promotion.itemId}`);
      }

      const salePrice = this.resolveProfitabilitySalePrice(promotion);
      if (!Number.isFinite(salePrice)) {
        throw new Error(`Missing profitability sale price for item ${promotion.itemId}`);
      }

      return {
        kind: 'candidate',
        candidate: {
          promotion,
          detail: {
            categoryId,
            listingTypeId,
            sku: promotion.sku,
            salePrice,
            sellerPercentage: promotion.terms?.resignation?.seller?.percentage,
            meliContributionPercentage: promotion.terms?.resignation?.mercadolibre?.percentage,
          },
        },
      };
    } catch (error) {
      await this.markAsFailed(promotion, input, error);
      return { kind: 'failure' };
    }
  }

  private async processResolvedMetrics(
    context: PromotionMetricsCandidate,
    metrics: Awaited<ReturnType<IAPIPriceApiRepository['getMetrics']>> | undefined,
    error: Error | undefined,
    input: DeactivatePromotionsInput,
  ): Promise<'success' | 'failure' | 'skipped'> {
    const { promotion } = context;

    try {
      if (error || !metrics) {
        Logger.warn(
          JSON.stringify({
            message: 'Price API revalidation failed and promotion will be deactivated defensively',
            process: 'deactivate',
            sourceProcess: input.sourceProcess,
            updatedBy: input.updatedBy,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            reason: error?.message ?? 'Metrics were not resolved',
          }),
        );

        await this.deleteOrPauseAndMark(
          promotion,
          input,
          'Price API revalidation failed during deactivation flow',
          'defensively because profitability could not be revalidated',
        );
        return 'success';
      }

      const updatedPromotion = this.buildPromotionWithUpdatedMetrics(
        promotion,
        context.detail.salePrice,
        metrics,
        input,
      );

      const profitabilityPasses = this.profitabilityPasses(
        updatedPromotion,
        context.detail.sellerPercentage,
      );
      const pricePasses = this.salePriceExceedsCost(updatedPromotion);
      const profitablePasses = updatedPromotion.economics.profitable === true;
      const evaluatedSalePrice = this.resolveProfitabilitySalePrice(updatedPromotion);

      if (profitabilityPasses && pricePasses && profitablePasses) {
        await this.builder.promotionRepository.update(updatedPromotion);
        Logger.info(
          JSON.stringify({
            message: 'Promotion kept active after profitability revalidation',
            process: 'deactivate',
            sourceProcess: input.sourceProcess,
            updatedBy: input.updatedBy,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            salePrice: evaluatedSalePrice,
            cost: updatedPromotion.economics.cost,
            profitability: updatedPromotion.economics.profitability,
            sellerPercentage: context.detail.sellerPercentage,
            profitable: updatedPromotion.economics.profitable,
          }),
        );
        return 'skipped';
      }

      Logger.info(
        JSON.stringify({
          message: 'Promotion failed profitability revalidation and will be deactivated',
          process: 'deactivate',
          sourceProcess: input.sourceProcess,
          updatedBy: input.updatedBy,
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          salePrice: evaluatedSalePrice,
          cost: updatedPromotion.economics.cost,
          profitability: updatedPromotion.economics.profitability,
          sellerPercentage: context.detail.sellerPercentage,
          profitable: updatedPromotion.economics.profitable,
          profitabilityPasses,
          pricePasses,
          profitablePasses,
        }),
      );

      await this.deleteOrPauseAndMark(
        updatedPromotion,
        input,
        'Current sale price no longer satisfies profitability rules',
        'automatically',
      );
      return 'success';
    } catch (caughtError) {
      const promotionToPersist =
        metrics && !error
          ? this.buildPromotionWithUpdatedMetrics(
              promotion,
              context.detail.salePrice,
              metrics,
              input,
            )
          : promotion;
      await this.markAsFailed(promotionToPersist, input, caughtError);
      return 'failure';
    }
  }

  private async retryFailedPromotion(
    promotion: Promotion,
    input: DeactivatePromotionsInput,
  ): Promise<'success' | 'failure' | 'skipped'> {
    try {
      if (promotion.type === PromotionType.DEAL) {
        if (this.isPromotionOutOfDate(promotion)) {
          await this.finishExpiredDeal(promotion, input);
          return 'success';
        }

        Logger.info(
          JSON.stringify({
            message: 'Skipping DEAL deactivation retry because DEAL promotions require manual deactivation',
            process: 'deactivate-failed',
            sourceProcess: input.sourceProcess,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            updatedBy: input.updatedBy,
          }),
        );

        return 'skipped';
      }

      if (this.isPromotionOutOfDate(promotion)) {
        await this.markAs(
          promotion,
          PromotionStatus.FINISHED,
          input,
          'Promotion is outside valid date range',
          'Promotion finished automatically because it is outside valid date range',
        );
        return 'success';
      }

      const itemDetail = await this.itemDetailResolver.resolveOne(promotion.itemId);
      const currentSalePrice = itemDetail.price;

      if (!Number.isFinite(currentSalePrice)) {
        throw new Error(`Missing current Mercado Libre price for item ${promotion.itemId}`);
      }

      let metrics:
        | Awaited<ReturnType<IAPIPriceApiRepository['getMetrics']>>
        | undefined;

      try {
        metrics = await this.builder.priceApiRepository.getMetrics({
          itemId: promotion.itemId,
          sku: itemDetail.sku || promotion.sku,
          categoryId: itemDetail.categoryId,
          publicationType: itemDetail.listingTypeId,
          salePrice: currentSalePrice,
          meliContributionPercentage: promotion.terms?.resignation?.mercadolibre?.percentage,
        });
      } catch (error) {
        Logger.warn(
          JSON.stringify({
            message: 'Price API revalidation failed during failed deactivation retry and promotion will be deactivated defensively',
            process: 'deactivate-failed',
            sourceProcess: input.sourceProcess,
            updatedBy: input.updatedBy,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            reason: error instanceof Error ? error.message : 'Unknown price-api error',
          }),
        );

        await this.deleteOrPauseAndMark(
          {
            ...promotion,
            sku: itemDetail.sku || promotion.sku,
            categoryId: itemDetail.categoryId,
            listingTypeId: itemDetail.listingTypeId,
          },
          input,
          'Price API revalidation failed during failed deactivation retry',
          'defensively because profitability could not be revalidated',
        );
        return 'success';
      }

      const updatedPromotion = this.buildPromotionWithUpdatedMetrics(
        {
          ...promotion,
          sku: itemDetail.sku || promotion.sku,
          categoryId: itemDetail.categoryId,
          listingTypeId: itemDetail.listingTypeId,
        },
        currentSalePrice,
        metrics,
        input,
      );

      const profitabilityPasses = this.profitabilityPasses(
        updatedPromotion,
        promotion.terms?.resignation?.seller?.percentage,
      );
      const pricePasses = this.salePriceExceedsCost(updatedPromotion);
      const profitablePasses = updatedPromotion.economics.profitable === true;

      if (profitabilityPasses && pricePasses && profitablePasses) {
        await this.builder.promotionRepository.update({
          ...updatedPromotion,
          status: PromotionStatus.ACTIVE,
          metadata: {
            ...updatedPromotion.metadata,
            updatedBy: input.updatedBy,
            sourceProcess: input.sourceProcess,
            reason: undefined,
            statusReason: 'Failed deactivation promotion revalidated and kept active',
          },
          auditTrail: [
            ...updatedPromotion.auditTrail,
            {
              process: input.sourceProcess,
              status: PromotionStatus.ACTIVE,
              reason: 'Failed deactivation promotion revalidated and kept active',
              executedAt: new Date(),
            },
          ],
        });

        Logger.info(
          JSON.stringify({
            message: 'Failed deactivation promotion revalidated and kept active',
            process: 'deactivate-failed',
            sourceProcess: input.sourceProcess,
            updatedBy: input.updatedBy,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            salePrice: currentSalePrice,
            cost: updatedPromotion.economics.cost,
            profitability: updatedPromotion.economics.profitability,
            profitable: updatedPromotion.economics.profitable,
          }),
        );
        return 'skipped';
      }

      await this.deleteOrPauseAndMark(
        updatedPromotion,
        input,
        'Failed deactivation promotion no longer satisfies profitability rules after revalidation',
        'after failed deactivation revalidation',
      );
      return 'success';
    } catch (error) {
      await this.markAsFailed(promotion, input, error);
      return 'failure';
    }
  }

  private isPromotionOutOfDate(promotion: Promotion): boolean {
    const now = new Date();
    const finishDate = promotion.finishDate;

    if (finishDate && now > finishDate) {
      return true;
    }

    return false;
  }

  private async fetchExistingMlas(mlas: string[]): Promise<{
    items: { mla: string; exists: boolean }[];
    total: number;
  }> {
    const chunks = this.chunkArray(mlas, DeactivatePromotions.CAMPAIGN_EXISTS_BULK_LIMIT);
    const responses = await Promise.all(
      chunks.map((chunk) => this.builder.campaignMlaApiRepository.existsBulk(chunk)),
    );

    return {
      items: responses.flatMap((response) => response.items ?? []),
      total: responses.reduce((accumulator, response) => accumulator + (response.total ?? 0), 0),
    };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private resolveLastProcessedId(
    promotions: Promotion[],
    fallback?: string,
  ): string | undefined {
    const lastPromotion = promotions[promotions.length - 1] as Promotion & {
      _id?: { toString(): string };
    };

    return lastPromotion._id?.toString() ?? fallback;
  }

  private profitabilityPasses(
    promotion: Promotion,
    sellerPercentage?: number,
  ): boolean {
    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    return (sellerPercentage ?? Number.POSITIVE_INFINITY) < profitability;
  }

  private salePriceExceedsCost(promotion: Promotion): boolean {
    const salePrice = this.resolveProfitabilitySalePrice(promotion);
    const cost = promotion.economics.cost ?? Number.POSITIVE_INFINITY;

    return salePrice > cost;
  }

  private resolveProfitabilitySalePrice(promotion: Promotion): number {
    if (promotion.type === PromotionType.DEAL) {
      return (
        promotion.prices.maxPrice ??
        promotion.prices.suggestedPrice ??
        promotion.prices.originalPrice ??
        Number.NEGATIVE_INFINITY
      );
    }

    return promotion.prices.suggestedPrice ?? Number.NEGATIVE_INFINITY;
  }
}
