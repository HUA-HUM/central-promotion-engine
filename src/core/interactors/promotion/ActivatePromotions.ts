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

      for (const promotion of promotions) {
        const promotionWithId = promotion as Promotion & { _id?: { toString(): string } };
        lastProcessedId = promotionWithId._id?.toString() ?? lastProcessedId;

        if (this.builder.config.syncPromotion && promotion.promotionId !== this.builder.config.syncPromotion) {
          skipped += 1;
          continue;
        }

        if (this.isDeadlineExpired(promotion)) {
          skipped += 1;
          continue;
        }

        if (!this.meetsProfitabilityRules(promotion)) {
          skipped += 1;
          continue;
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
          success += 1;
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
        } catch (error: unknown) {
          failure += 1;
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
        }
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
}
