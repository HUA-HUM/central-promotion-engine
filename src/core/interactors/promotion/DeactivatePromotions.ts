import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { IAPICampaignMlaApiRepository } from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import { IAPIMercadolibreApiRepository } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { IAPIPriceApiRepository } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';
import {
  PriceMetricsBulkResolver,
  PriceMetricsRequest,
} from '@core/interactors/promotion/services/PriceMetricsBulkResolver';

interface PromotionMetricsCandidate {
  promotion: Promotion;
  detail: {
    categoryId: string;
    listingTypeId: string;
    sku?: string;
    salePrice: number;
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
  config: AppConfig;
}

export class DeactivatePromotions {
  private static readonly BATCH_SIZE = 500;
  private static readonly CAMPAIGN_EXISTS_BULK_LIMIT = 100;
  private static readonly DETAIL_CONCURRENCY = 10;
  private static readonly DEACTIVATION_CONCURRENCY = 10;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;

  constructor(private readonly builder: DeactivatePromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
    this.promotionModelsRegistry = PromotionModelsRegistry.forActivation();
  }

  async execute(input: DeactivatePromotionsInput): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: 'Promotion deactivation process started',
        process: 'deactivate',
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
      const promotions = await this.builder.promotionRepository.findActiveBatch(
        lastProcessedId,
        DeactivatePromotions.BATCH_SIZE,
      );

      if (promotions.length === 0) {
        break;
      }

      total += promotions.length;
      lastProcessedId = this.resolveLastProcessedId(promotions, lastProcessedId);

      const activeMlas = promotions.map((promotion) => promotion.itemId);
      const existingMlasResponse = activeMlas.length
        ? await this.fetchExistingMlas(activeMlas)
        : { items: [], total: 0 };
      const existingMlas = new Set(
        (existingMlasResponse.items ?? [])
          .filter((item) => item.exists)
          .map((item) => item.mla),
      );

      const batchPreparationResults = await this.mapWithConcurrency(
        promotions,
        DeactivatePromotions.DETAIL_CONCURRENCY,
        async (promotion) => this.preparePromotion(promotion, existingMlas, input),
      );

      const metricsCandidates: PromotionMetricsCandidate[] = [];

      for (const batchPreparationResult of batchPreparationResults) {
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
            meliContributionPercentage:
              candidate.promotion.terms?.resignation?.mercadolibre?.percentage,
          },
        }),
      );

      const resolvedMetrics = await this.priceMetricsResolver.resolve(metricsRequests);

      const metricsResults = await this.mapWithConcurrency(
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
      process: 'deactivate',
      total,
      success,
      failure,
      skipped,
    };

    const finishedAt = new Date();
    const durationMinutes = Number(
      ((finishedAt.getTime() - startedAt.getTime()) / 60000).toFixed(2),
    );

    Logger.info(
      JSON.stringify({
        message: 'Promotion deactivation process finished',
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

  private buildPromotionWithUpdatedMetrics(
    promotion: Promotion,
    currentSalePrice: number,
    currentMetrics: Awaited<ReturnType<IAPIPriceApiRepository['getMetrics']>>,
  ): Promotion {
    return {
      ...promotion,
      prices: {
        ...promotion.prices,
        originalPrice: currentSalePrice,
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
  > {
    try {
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

      const detail = await this.builder.mercadolibreApiRepository.getItemDetail(promotion.itemId);
      const categoryId = detail.categoryId ?? promotion.categoryId;
      if (!categoryId) {
        throw new Error(`Missing categoryId for item ${promotion.itemId}`);
      }

      return {
        kind: 'candidate',
        candidate: {
          promotion,
          detail: {
            categoryId,
            listingTypeId: detail.listingTypeId,
            sku: detail.sku ?? promotion.sku,
            salePrice: detail.price ?? promotion.prices.originalPrice ?? 0,
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
        throw error ?? new Error('Metrics were not resolved');
      }

      const updatedPromotion = this.buildPromotionWithUpdatedMetrics(
        promotion,
        context.detail.salePrice,
        metrics,
      );

      if (this.stillMeetsRules(updatedPromotion)) {
        await this.builder.promotionRepository.update(updatedPromotion);
        return 'skipped';
      }

      await this.deleteOrPauseAndMark(
        updatedPromotion,
        input,
        'Current sale price no longer satisfies profitability rules',
        'automatically',
      );
      return 'success';
    } catch (caughtError) {
      await this.markAsFailed(promotion, input, caughtError);
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

  private async mapWithConcurrency<TItem, TResult>(
    items: TItem[],
    concurrency: number,
    mapper: (item: TItem) => Promise<TResult>,
  ): Promise<TResult[]> {
    const results: TResult[] = new Array(items.length);
    let currentIndex = 0;

    const worker = async (): Promise<void> => {
      while (currentIndex < items.length) {
        const index = currentIndex;
        currentIndex += 1;
        results[index] = await mapper(items[index]);
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    );

    await Promise.all(workers);

    return results;
  }

  private stillMeetsRules(promotion: Promotion): boolean {
    if (promotion.economics.profitable === false) {
      return false;
    }

    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    if (profitability <= 0) {
      return false;
    }

    const salePrice =
      promotion.prices.suggestedPrice ??
      promotion.prices.originalPrice ??
      Number.NEGATIVE_INFINITY;
    const cost = promotion.economics.cost ?? Number.POSITIVE_INFINITY;

    return salePrice > cost;
  }
}
