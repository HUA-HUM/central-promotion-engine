import { AppConfig } from '@app/drivers/config/AppConfig';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import {
  ActivatePromotionCommand,
  MercadolibreApiRepository,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';

export interface ActivatePromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface ActivatePromotionsBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  config: AppConfig;
}

export class ActivatePromotions {
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

    const promotions = await this.builder.promotionRepository.findPendingActivation();

    let success = 0;
    let failure = 0;
    let skipped = 0;

    for (const promotion of promotions) {
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

    const result: ProcessResult = {
      process: 'activate',
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
