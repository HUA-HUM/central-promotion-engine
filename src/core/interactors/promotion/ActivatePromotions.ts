import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { IAPIPriceApiRepository } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { Logger } from '@core/drivers/logger/Logger';
import {
  ActivatePromotionCommand,
  IAPIMercadolibreApiRepository,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';

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

export class ActivatePromotions {
  private static readonly BATCH_SIZE = 500;
  private static readonly ACTIVATION_CONCURRENCY = 10;
  private readonly promotionModelsRegistry: PromotionModelsRegistry;

  constructor(private readonly builder: ActivatePromotionsBuilder) {
    this.promotionModelsRegistry = PromotionModelsRegistry.forActivation();
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

      const batchResults = await this.mapWithConcurrency(
        promotions,
        ActivatePromotions.ACTIVATION_CONCURRENCY,
        async (promotion) => this.processPromotion(promotion, input),
      );

      for (const batchResult of batchResults) {
        if (batchResult === 'success') {
          success += 1;
          continue;
        }

        if (batchResult === 'failure') {
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
    const durationMinutes = Number(
      ((finishedAt.getTime() - startedAt.getTime()) / 60000).toFixed(2),
    );

    Logger.info(
      JSON.stringify({
        message: 'Promotion activation process finished',
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

  private async processPromotion(
    promotion: Promotion,
    input: ActivatePromotionsInput,
  ): Promise<'success' | 'failure' | 'skipped'> {
    if (this.builder.config.syncPromotion && promotion.promotionId !== this.builder.config.syncPromotion) {
      return 'skipped';
    }

    if (this.isDeadlineExpired(promotion)) {
      return 'skipped';
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

      return 'skipped';
    }

    // if (promotion.type === PromotionType.DEAL) {
    //   const hasAnotherActiveDeal = await this.builder.promotionRepository.hasActivePromotionForItem(
    //     promotion.itemId,
    //     PromotionType.DEAL,
    //     promotion.promotionId,
    //   );
    //
    //   if (hasAnotherActiveDeal) {
    //     Logger.info(
    //       JSON.stringify({
    //         message: 'Skipping DEAL activation because another DEAL promotion is already active for the item',
    //         process: 'activate',
    //         sourceProcess: input.sourceProcess,
    //         promotionId: promotion.promotionId,
    //         itemId: promotion.itemId,
    //         updatedBy: input.updatedBy,
    //       }),
    //     );
    //
    //     return 'skipped';
    //   }
    // }

    try {
      const revalidatedPromotion = await this.revalidatePromotion(promotion, input);

      if (!this.meetsProfitabilityRules(revalidatedPromotion)) {
        return 'skipped';
      }

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
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown activation error';
      const revalidatedPromotion = await this.tryRevalidatePromotionOnFailure(promotion, input);
      await this.builder.promotionRepository.update({
        ...revalidatedPromotion,
        status: PromotionStatus.FAILED_ACTIVATION,
        metadata: {
          ...revalidatedPromotion.metadata,
          updatedBy: input.updatedBy,
          sourceProcess: input.sourceProcess,
          statusReason: reason,
          reason,
        },
        auditTrail: [
          ...revalidatedPromotion.auditTrail,
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
          promotionId: revalidatedPromotion.promotionId,
          itemId: revalidatedPromotion.itemId,
          reason,
        }),
      );

      return 'failure';
    }
  }

  private async revalidatePromotion(
    promotion: Promotion,
    input: ActivatePromotionsInput,
  ): Promise<Promotion> {
    const salePrice = this.resolveProfitabilitySalePrice(promotion);
    if (!Number.isFinite(salePrice)) {
      throw new Error(`Missing profitability sale price for item ${promotion.itemId}`);
    }

    const metrics = await this.builder.priceApiRepository.getMetrics({
      itemId: promotion.itemId,
      sku: promotion.sku,
      categoryId: promotion.categoryId,
      publicationType: promotion.listingTypeId,
      salePrice,
      meliContributionPercentage: promotion.terms?.resignation?.mercadolibre?.percentage,
    });

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

  private async tryRevalidatePromotionOnFailure(
    promotion: Promotion,
    input: ActivatePromotionsInput,
  ): Promise<Promotion> {
    try {
      return await this.revalidatePromotion(promotion, input);
    } catch {
      return {
        ...promotion,
        metadata: {
          ...promotion.metadata,
          updatedBy: input.updatedBy,
          sourceProcess: input.sourceProcess,
        },
      };
    }
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
