import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import {
  ActivatePromotionCommand,
  IAPIMercadolibreApiRepository,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';

export interface ActivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface ActivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
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

    const salePrice =
      promotion.prices.suggestedPrice ??
      promotion.prices.originalPrice ??
      Number.NEGATIVE_INFINITY;
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

    if (!this.meetsProfitabilityRules(promotion)) {
      return 'skipped';
    }

    try {
      const response = await this.builder.mercadolibreApiRepository.activatePromotion(
        this.buildActivateCommand(promotion),
      );

      const updatedPromotion: Promotion = {
        ...promotion,
        status: PromotionStatus.ACTIVE,
        offerId: response.offerId ?? promotion.offerId,
        metadata: {
          ...promotion.metadata,
          activatedAt: new Date(),
          updatedBy: input.updatedBy,
          sourceProcess: input.sourceProcess,
          statusReason: 'Promotion activated automatically',
        },
        auditTrail: [
          ...promotion.auditTrail,
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
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          offerId: updatedPromotion.offerId,
          updatedBy: input.updatedBy,
        }),
      );

      return 'success';
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown activation error';
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

      return 'failure';
    }
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
