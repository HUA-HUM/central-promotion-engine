import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import {
  IAPIPriceApiRepository,
  PriceMetrics,
} from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { Logger } from '@core/drivers/logger/Logger';
import {
  ActivatePromotionCommand,
  IAPIMercadolibreApiRepository,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';
import {
  PriceMetricsBulkResolver,
  PriceMetricsRequest,
} from '@core/interactors/promotion/services/PriceMetricsBulkResolver';

export interface ActivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface ActivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  priceApiRepository: IAPIPriceApiRepository;
  config: AppConfig;
}

interface PromotionActivationCandidate {
  promotion: Promotion;
  salePrice: number;
}

export class ActivatePromotions {
  private static readonly BATCH_SIZE = 500;
  private static readonly ACTIVATION_CONCURRENCY = 10;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;

  constructor(private readonly builder: ActivatePromotionsBuilder) {
    this.promotionModelsRegistry = PromotionModelsRegistry.forActivation();
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
  }

  async execute(input: ActivatePromotionsInput): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: 'Promotion activation process started',
        process: 'activate',
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
      const promotions = await this.builder.promotionRepository.findPendingActivationBatch(
        lastProcessedId,
        ActivatePromotions.BATCH_SIZE,
      );

      if (promotions.length === 0) {
        break;
      }

      total += promotions.length;
      lastProcessedId = this.resolveLastProcessedId(promotions, lastProcessedId);

      const candidates: PromotionActivationCandidate[] = [];

      for (const promotion of promotions) {
        const preparationResult = await this.prepareActivationCandidate(promotion, input);

        if (preparationResult.kind === 'candidate') {
          candidates.push(preparationResult.candidate);
          continue;
        }

        if (preparationResult.kind === 'success') {
          success += 1;
          continue;
        }

        if (preparationResult.kind === 'failure') {
          failure += 1;
          continue;
        }

        skipped += 1;
      }

      const metricsRequests: PriceMetricsRequest<PromotionActivationCandidate>[] = candidates.map(
        (candidate) => ({
          context: candidate,
          input: {
            itemId: candidate.promotion.itemId,
            sku: candidate.promotion.sku,
            categoryId: candidate.promotion.categoryId,
            publicationType: candidate.promotion.listingTypeId,
            salePrice: candidate.salePrice,
            meliContributionPercentage:
              candidate.promotion.terms?.resignation?.mercadolibre?.percentage,
          },
        }),
      );

      const { results: resolvedMetrics } = await this.priceMetricsResolver.resolve(metricsRequests);

      const activationResults = await this.mapWithConcurrency(
        resolvedMetrics,
        ActivatePromotions.ACTIVATION_CONCURRENCY,
        async (resolved) =>
          this.finalizeActivation(resolved.context, resolved.metrics, resolved.error, input),
      );

      for (const activationResult of activationResults) {
        if (activationResult === 'success') {
          success += 1;
          continue;
        }

        if (activationResult === 'failure') {
          failure += 1;
          continue;
        }

        skipped += 1;
      }
    }

    const result: ProcessResult = {
      process: 'activate',
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
        message: 'Promotion activation process finished',
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

  private meetsProfitabilityRules(promotion: Promotion): boolean {
    if (promotion.economics.profitable === false) {
      return false;
    }

    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    if (profitability <= 0) {
      return false;
    }

    const salePrice = this.resolveProfitabilitySalePrice(promotion);
    const cost = promotion.economics.cost ?? Number.POSITIVE_INFINITY;

    return salePrice > cost;
  }

  private isDeadlineExpired(promotion: Promotion): boolean {
    if (!promotion.deadlineDate) {
      return false;
    }

    return new Date() > promotion.deadlineDate;
  }

  private buildActivateCommand(promotion: Promotion): ActivatePromotionCommand {
    return this.promotionModelsRegistry.resolve(promotion.type).buildActivationCommand(promotion);
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

  private async prepareActivationCandidate(
    promotion: Promotion,
    input: ActivatePromotionsInput,
  ): Promise<
    | { kind: 'candidate'; candidate: PromotionActivationCandidate }
    | { kind: 'success' }
    | { kind: 'failure' }
    | { kind: 'skipped' }
  > {
    if (this.builder.config.syncPromotion && promotion.promotionId !== this.builder.config.syncPromotion) {
      return { kind: 'skipped' };
    }

    if (this.isDeadlineExpired(promotion)) {
      return { kind: 'skipped' };
    }

    if (promotion.type === PromotionType.DEAL) {
      Logger.info(
        JSON.stringify({
          message: 'Skipping DEAL activation because DEAL promotions require manual activation',
          process: 'activate',
          sourceProcess: input.sourceProcess,
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          updatedBy: input.updatedBy,
        }),
      );

      return { kind: 'skipped' };
    }

    const salePrice = this.resolveProfitabilitySalePrice(promotion);
    if (!Number.isFinite(salePrice)) {
      await this.markAsFailed(
        promotion,
        input,
        `Missing profitability sale price for item ${promotion.itemId}`,
      );
      return { kind: 'failure' };
    }

    return { kind: 'candidate', candidate: { promotion, salePrice } };
  }

  private async finalizeActivation(
    candidate: PromotionActivationCandidate,
    metrics: PriceMetrics | undefined,
    error: Error | undefined,
    input: ActivatePromotionsInput,
  ): Promise<'success' | 'failure' | 'skipped'> {
    const { promotion, salePrice } = candidate;

    if (error || !metrics) {
      await this.markAsFailed(
        promotion,
        input,
        error?.message ?? `Missing price metrics for item ${promotion.itemId}`,
      );
      return 'failure';
    }

    const revalidatedPromotion = this.buildRevalidatedPromotion(promotion, salePrice, metrics, input);

    if (!this.meetsProfitabilityRules(revalidatedPromotion)) {
      return 'skipped';
    }

    try {
      const response = await this.builder.mercadolibreApiRepository.activatePromotion(
        this.buildActivateCommand(revalidatedPromotion),
      );

      const updatedPromotion: Promotion = {
        ...revalidatedPromotion,
        status: PromotionStatus.ACTIVE,
        offerId: response.offerId ?? revalidatedPromotion.offerId,
        metadata: {
          ...revalidatedPromotion.metadata,
          activatedAt: new Date(),
          updatedBy: input.updatedBy,
          sourceProcess: input.sourceProcess,
          statusReason: 'Promotion activated automatically',
        },
        auditTrail: [
          ...revalidatedPromotion.auditTrail,
          {
            process: input.sourceProcess,
            status: PromotionStatus.ACTIVE,
            reason: 'Profitability rules passed',
            executedAt: new Date(),
          },
        ],
      };

      await this.builder.promotionRepository.update(updatedPromotion);
      Logger.info(
        JSON.stringify({
          message: 'Promotion activated',
          process: 'activate',
          sourceProcess: input.sourceProcess,
          promotionId: revalidatedPromotion.promotionId,
          itemId: revalidatedPromotion.itemId,
          offerId: updatedPromotion.offerId,
          updatedBy: input.updatedBy,
        }),
      );

      return 'success';
    } catch (activationError: unknown) {
      const reason =
        activationError instanceof Error ? activationError.message : 'Unknown activation error';
      await this.markAsFailed(revalidatedPromotion, input, reason);
      return 'failure';
    }
  }

  private buildRevalidatedPromotion(
    promotion: Promotion,
    salePrice: number,
    metrics: PriceMetrics,
    input: ActivatePromotionsInput,
  ): Promotion {
    return {
      ...promotion,
      prices: {
        ...promotion.prices,
        ...(promotion.type === PromotionType.DEAL
          ? { maxPrice: salePrice }
          : { suggestedPrice: salePrice }),
      },
      economics: {
        ...promotion.economics,
        cost: metrics.cost ?? promotion.economics.cost,
        profit: metrics.profit ?? promotion.economics.profit,
        profitability: metrics.profitability ?? promotion.economics.profitability,
        margin: metrics.margin ?? promotion.economics.margin,
        profitable: metrics.profitable ?? promotion.economics.profitable,
        shouldPause: metrics.shouldPause ?? promotion.economics.shouldPause,
      },
      metadata: {
        ...promotion.metadata,
        updatedBy: input.updatedBy,
        sourceProcess: input.sourceProcess,
        statusReason: 'Promotion revalidated before activation',
      },
    };
  }

  private async markAsFailed(
    promotion: Promotion,
    input: ActivatePromotionsInput,
    reason: string,
  ): Promise<void> {
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

  private resolveProfitabilitySalePrice(promotion: Promotion): number {
    if (promotion.type === PromotionType.DEAL) {
      return (
        promotion.prices.maxPrice ??
        promotion.prices.suggestedPrice ??
        promotion.prices.originalPrice ??
        Number.NEGATIVE_INFINITY
      );
    }

    return (
      promotion.prices.suggestedPrice ??
      promotion.prices.originalPrice ??
      Number.NEGATIVE_INFINITY
    );
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
}
