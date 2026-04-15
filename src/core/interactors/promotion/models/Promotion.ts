import {
  EligibleItem,
  ItemDetail,
  ActivatePromotionCommand,
  PauseOrDeletePromotionCommand,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository, PriceMetrics } from '@core/adapters/repositories/IPriceApiRepository';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog, PromotionType } from '@core/entities/PromotionCatalog';

export interface PromotionExecutionContext {
  sourceProcess: string;
  updatedBy: string;
}

export interface PromotionBuilderInput {
  promotionCatalog: PromotionCatalog;
  eligibleItem: EligibleItem;
  itemDetail: ItemDetail;
  input: PromotionExecutionContext;
  priceMetrics?: PriceMetrics;
}

export interface PromotionBuilder {
  readonly type: PromotionType;
  build(command: PromotionBuilderInput): Promise<Promotion>;
}

export interface PromotionModel extends PromotionBuilder {
  buildActivationCommand(promotion: Promotion): ActivatePromotionCommand;
  buildDeactivationCommand(
    promotion: Promotion,
    action: 'pause' | 'delete',
  ): PauseOrDeletePromotionCommand;
}

export interface PromotionBuilderDependencies {
  priceApiRepository: PriceApiRepository;
}

export class GenericPromotion implements PromotionModel {
  readonly type: PromotionType = PromotionType.UNKNOWN;

  constructor(protected readonly dependencies?: PromotionBuilderDependencies) {}

  async build(command: PromotionBuilderInput): Promise<Promotion> {
    return this.buildBasePromotion(command);
  }

  protected async buildBasePromotion(command: PromotionBuilderInput): Promise<Promotion> {
    if (!this.dependencies) {
      throw new Error('Price API repository is required to build promotions');
    }

    const { eligibleItem, itemDetail } = command;
    const suggestedPrice = eligibleItem.suggestedPrice ?? itemDetail.price ?? 0;
    const metrics =
      command.priceMetrics ??
      (await this.dependencies.priceApiRepository.getMetrics({
        itemId: eligibleItem.itemId,
        sku: itemDetail.sku,
        categoryId: itemDetail.categoryId,
        publicationType: itemDetail.listingTypeId,
        salePrice: suggestedPrice,
        meliContributionPercentage: eligibleItem.meliPercentage,
      }));

    const now = new Date();
    return {
      itemId: eligibleItem.itemId,
      promotionId: command.promotionCatalog.promotionId,
      name: command.promotionCatalog.name,
      type: command.promotionCatalog.type,
      startDate: command.promotionCatalog.startDate,
      finishDate: command.promotionCatalog.finishDate,
      deadlineDate: command.promotionCatalog.deadlineDate,
      status: PromotionStatus.SYNCED,
      sku: itemDetail.sku,
      categoryId: itemDetail.categoryId,
      listingTypeId: itemDetail.listingTypeId,
      prices: {
        originalPrice: eligibleItem.originalPrice,
        minPrice: eligibleItem.minPrice,
        maxPrice: eligibleItem.maxPrice,
        suggestedPrice: eligibleItem.suggestedPrice,
      },
      economics: {
        cost: metrics.cost,
        profit: metrics.profit,
        profitability: metrics.profitability,
        margin: metrics.margin,
        profitable: metrics.profitable,
        shouldPause: metrics.shouldPause,
      },
      metadata: {
        syncedAt: now,
        updatedBy: command.input.updatedBy,
        sourceProcess: command.input.sourceProcess,
        statusReason: 'Promotion synchronized',
      },
      auditTrail: [
        {
          process: command.input.sourceProcess,
          status: PromotionStatus.SYNCED,
          executedAt: now,
          reason: 'Promotion synchronized',
        },
      ],
    };
  }

  buildActivationCommand(promotion: Promotion): ActivatePromotionCommand {
    return {
      promotionId: promotion.promotionId,
      promotionType: promotion.type,
      itemId: promotion.itemId,
      offerId: promotion.offerId,
    };
  }

  buildDeactivationCommand(
    promotion: Promotion,
    action: 'pause' | 'delete',
  ): PauseOrDeletePromotionCommand {
    return {
      promotionId: promotion.promotionId,
      promotionType: promotion.type,
      itemId: promotion.itemId,
      action,
    };
  }
}
