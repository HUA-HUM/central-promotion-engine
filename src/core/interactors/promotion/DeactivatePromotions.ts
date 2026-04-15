import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { CampaignMlaApiRepository } from '@core/adapters/repositories/ICampaignMlaApiRepository';
import { MercadolibreApiRepository } from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
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
  campaignMlaApiRepository: CampaignMlaApiRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  priceApiRepository: PriceApiRepository;
  config: AppConfig;
}

export class DeactivatePromotions {
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

    const promotions = await this.builder.promotionRepository.findActive();
    const activeMlas = promotions.map((promotion) => promotion.itemId);
    const existingMlasResponse = activeMlas.length
      ? await this.builder.campaignMlaApiRepository.existsBulk(activeMlas)
      : { items: [], total: 0 };
    const existingMlas = new Set(
      (existingMlasResponse.items ?? [])
        .filter((item) => item.exists)
        .map((item) => item.mla),
    );

    let success = 0;
    let failure = 0;
    let skipped = 0;

    const metricsCandidates: PromotionMetricsCandidate[] = [];

    for (const promotion of promotions) {
      try {
        if (this.isPromotionOutOfDate(promotion)) {
          await this.markAs(
            promotion,
            PromotionStatus.FINISHED,
            input,
            'Promotion is outside valid date range',
            'Promotion finished automatically because it is outside valid date range',
          );
          success += 1;
          continue;
        }

        if (!existingMlas.has(promotion.itemId)) {
          await this.deleteOrPauseAndMark(
            promotion,
            input,
            'Promotion item no longer exists in campaign repository',
            'because item is not in campaign repository',
          );
          success += 1;
          continue;
        }

        const detail = await this.builder.mercadolibreApiRepository.getItemDetail(promotion.itemId);
        const categoryId = detail.categoryId ?? promotion.categoryId;
        if (!categoryId) {
          throw new Error(`Missing categoryId for item ${promotion.itemId}`);
        }

        metricsCandidates.push({
          promotion,
          detail: {
            categoryId,
            listingTypeId: detail.listingTypeId,
            sku: detail.sku ?? promotion.sku,
            salePrice: detail.price ?? promotion.prices.originalPrice ?? 0,
          },
        });
      } catch (error) {
        failure += 1;
        await this.markAsFailed(promotion, input, error);
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

    for (const resolved of resolvedMetrics) {
      const { promotion } = resolved.context;

      try {
        if (resolved.error || !resolved.metrics) {
          throw resolved.error ?? new Error('Metrics were not resolved');
        }

        const updatedPromotion = this.buildPromotionWithUpdatedMetrics(
          promotion,
          resolved.context.detail.salePrice,
          resolved.metrics,
        );

        if (this.stillMeetsRules(updatedPromotion)) {
          await this.builder.promotionRepository.update(updatedPromotion);
          skipped += 1;
          continue;
        }

        await this.deleteOrPauseAndMark(
          updatedPromotion,
          input,
          'Current sale price no longer satisfies profitability rules',
          'automatically',
        );
        success += 1;
      } catch (error) {
        failure += 1;
        await this.markAsFailed(promotion, input, error);
      }
    }

    const result: ProcessResult = {
      process: 'deactivate',
      total: promotions.length,
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
    currentMetrics: Awaited<ReturnType<PriceApiRepository['getMetrics']>>,
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

  private isPromotionOutOfDate(promotion: Promotion): boolean {
    const now = new Date();
    const finishDate = promotion.finishDate;

    if (finishDate && now > finishDate) {
      return true;
    }

    return false;
  }

  private stillMeetsRules(promotion: Promotion): boolean {
    if (promotion.economics.shouldPause === true) {
      return false;
    }

    if (promotion.economics.profitable === false) {
      return false;
    }

    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    const profit = promotion.economics.profit ?? Number.NEGATIVE_INFINITY;
    const minAllowed = this.builder.config.defaultMinProfitability;

    return profitability >= minAllowed && profit >= this.builder.config.defaultMinProfit;
  }
}
