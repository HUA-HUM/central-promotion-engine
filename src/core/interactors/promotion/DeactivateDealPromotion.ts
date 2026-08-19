import {
  IAPIMercadolibreApiRepository,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';
import { DealPriceControlService } from '@core/interactors/promotion/services/DealPriceControlService';

export interface DeactivateDealPromotionInput {
  promotionId: string;
  /**
   * MLAs to deactivate. `undefined`/`null` deactivates every synced item of the promotion.
   * An explicit empty array deactivates nothing.
   */
  mlas?: string[] | null;
  updatedBy: string;
}

export interface DeactivateDealPromotionItemResult {
  itemId: string;
  status: 'success' | 'failure';
  action?: 'pause' | 'delete';
  reason?: string;
  promotion?: Promotion;
}

export interface DeactivateDealPromotionResult {
  promotionId: string;
  total: number;
  success: number;
  failure: number;
  items: DeactivateDealPromotionItemResult[];
}

export interface DeactivateDealPromotionBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  dealPriceControlService: DealPriceControlService;
}

export class DeactivateDealPromotion {
  private static readonly SOURCE_PROCESS = 'manual-deal-deactivate';
  private static readonly CONCURRENCY = 5;
  private readonly promotionModelsRegistry = PromotionModelsRegistry.forActivation();

  constructor(private readonly builder: DeactivateDealPromotionBuilder) {}

  async execute(input: DeactivateDealPromotionInput): Promise<DeactivateDealPromotionResult> {
    const promotions = await this.builder.promotionRepository.findByPromotionId(input.promotionId);

    if (promotions.length === 0) {
      throw new Error(`Promotion ${input.promotionId} has no synced items`);
    }

    if (promotions.some((promotion) => promotion.type !== PromotionType.DEAL)) {
      throw new Error(`Promotion ${input.promotionId} is not a DEAL promotion`);
    }

    const { targets, notFoundItemIds } = this.resolveTargets(promotions, input.mlas);

    const notFoundResults: DeactivateDealPromotionItemResult[] = notFoundItemIds.map((itemId) => ({
      itemId,
      status: 'failure',
      reason: `Item ${itemId} was not found among the synced items for promotion ${input.promotionId}`,
    }));

    const processedResults = await this.mapWithConcurrency(
      targets,
      DeactivateDealPromotion.CONCURRENCY,
      (promotion) => this.processPromotion(promotion, input),
    );

    return this.summarize(input.promotionId, [...processedResults, ...notFoundResults]);
  }

  private resolveTargets(
    promotions: Promotion[],
    mlas: string[] | null | undefined,
  ): { targets: Promotion[]; notFoundItemIds: string[] } {
    if (mlas === undefined || mlas === null) {
      return { targets: promotions, notFoundItemIds: [] };
    }

    const byItemId = new Map(promotions.map((promotion) => [promotion.itemId, promotion]));
    const targets: Promotion[] = [];
    const notFoundItemIds: string[] = [];

    for (const itemId of new Set(mlas)) {
      const promotion = byItemId.get(itemId);
      if (promotion) {
        targets.push(promotion);
      } else {
        notFoundItemIds.push(itemId);
      }
    }

    return { targets, notFoundItemIds };
  }

  private summarize(
    promotionId: string,
    items: DeactivateDealPromotionItemResult[],
  ): DeactivateDealPromotionResult {
    return {
      promotionId,
      total: items.length,
      success: items.filter((item) => item.status === 'success').length,
      failure: items.filter((item) => item.status === 'failure').length,
      items,
    };
  }

  private async processPromotion(
    promotion: Promotion,
    input: DeactivateDealPromotionInput,
  ): Promise<DeactivateDealPromotionItemResult> {
    const action: 'pause' | 'delete' = promotion.offerId ? 'pause' : 'delete';

    try {
      const command = this.promotionModelsRegistry
        .resolve(PromotionType.DEAL)
        .buildDeactivationCommand(promotion, action);

      await this.builder.mercadolibreApiRepository.pauseOrDeletePromotion(command);

      const releasedPriceControl = await this.builder.dealPriceControlService.release(promotion);

      const now = new Date();
      const status = action === 'pause' ? PromotionStatus.PAUSED : PromotionStatus.DELETED;

      const deactivatedPromotion: Promotion = {
        ...promotion,
        status,
        priceControl: releasedPriceControl,
        metadata: {
          ...promotion.metadata,
          deactivatedAt: now,
          updatedBy: input.updatedBy,
          sourceProcess: DeactivateDealPromotion.SOURCE_PROCESS,
          reason: 'Manual DEAL deactivation',
          statusReason: `Promotion ${action}d manually`,
        },
        auditTrail: [
          ...promotion.auditTrail,
          {
            process: DeactivateDealPromotion.SOURCE_PROCESS,
            status,
            reason: 'Manual DEAL deactivation',
            executedAt: now,
          },
        ],
      };

      await this.builder.promotionRepository.update(deactivatedPromotion);

      Logger.info(
        JSON.stringify({
          message: 'DEAL promotion deactivated manually',
          process: DeactivateDealPromotion.SOURCE_PROCESS,
          promotionId: deactivatedPromotion.promotionId,
          itemId: deactivatedPromotion.itemId,
          action,
          priceControlStatus: releasedPriceControl?.status,
          updatedBy: input.updatedBy,
        }),
      );

      return { itemId: promotion.itemId, status: 'success', action, promotion: deactivatedPromotion };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown DEAL deactivation error';
      const failedPromotion: Promotion = {
        ...promotion,
        status: PromotionStatus.FAILED_DEACTIVATION,
        metadata: {
          ...promotion.metadata,
          updatedBy: input.updatedBy,
          sourceProcess: DeactivateDealPromotion.SOURCE_PROCESS,
          reason,
          statusReason: reason,
        },
        auditTrail: [
          ...promotion.auditTrail,
          {
            process: DeactivateDealPromotion.SOURCE_PROCESS,
            status: PromotionStatus.FAILED_DEACTIVATION,
            reason,
            executedAt: new Date(),
          },
        ],
      };

      await this.builder.promotionRepository.update(failedPromotion);

      Logger.error(
        JSON.stringify({
          message: 'Manual DEAL deactivation failed',
          process: DeactivateDealPromotion.SOURCE_PROCESS,
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          reason,
        }),
      );

      return { itemId: promotion.itemId, status: 'failure', action, reason, promotion: failedPromotion };
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

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
}
