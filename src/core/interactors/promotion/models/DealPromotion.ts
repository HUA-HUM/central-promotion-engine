import { Logger } from '@core/drivers/logger/Logger';
import { Promotion } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import {
  ActivatePromotionCommand,
  EligibleItem,
  ItemDetail,
  PauseOrDeletePromotionCommand,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import {
  GenericPromotion,
  PromotionBuilderInput,
  PromotionPriceControlHookParams,
} from '@core/interactors/promotion/models/Promotion';

export class DealPromotion extends GenericPromotion {
  readonly type = PromotionType.DEAL;

  async build(command: PromotionBuilderInput): Promise<Promotion> {
    const basePromotion = await this.buildBasePromotion(command);
    return {
      ...basePromotion,
      offerId: command.eligibleItem.offerId,
    };
  }

  resolveSyncSalePrice(eligibleItem: EligibleItem, itemDetail: ItemDetail): number {
    return this.resolveDealPrice(eligibleItem, itemDetail);
  }

  async applyPriceControl(params: PromotionPriceControlHookParams): Promise<Promotion> {
    const { context } = params;
    const currentDealPrice = this.resolveDealPrice(context.eligibleItem, context.itemDetail);
    const referenceBasePrice = context.eligibleItem.originalPrice ?? context.itemDetail.price;
    const discountRatio = referenceBasePrice ? currentDealPrice / referenceBasePrice : undefined;

    if (this.dependencies?.metricsLoggingEnabled) {
      Logger.info(
        JSON.stringify({
          message: 'DEAL sync computed price and profitability metrics',
          process: 'sync',
          promotionId: context.promotionCatalog.promotionId,
          itemId: context.eligibleItem.itemId,
          originalPrice: context.eligibleItem.originalPrice,
          maxPrice: context.eligibleItem.maxPrice,
          suggestedPrice: context.eligibleItem.suggestedPrice,
          currentBasePrice: context.itemDetail.price,
          currentDealPrice,
          discountRatio,
          profitable: params.metrics.profitable,
          cost: params.metrics.cost,
          profitability: params.metrics.profitability,
        }),
      );
    }

    const dealPriceControlService = this.dependencies?.dealPriceControlService;
    if (!dealPriceControlService) {
      return params.promotion;
    }

    const priceControl = await dealPriceControlService.evaluate({
      itemId: context.eligibleItem.itemId,
      promotionId: context.promotionCatalog.promotionId,
      sku: context.itemDetail.sku,
      categoryId: context.itemDetail.categoryId,
      publicationType: context.itemDetail.listingTypeId,
      originalPrice: context.eligibleItem.originalPrice,
      itemPrice: context.itemDetail.price,
      currentDealPrice: this.resolveDealPrice(context.eligibleItem, context.itemDetail),
      meliContributionPercentage: context.eligibleItem.meliPercentage,
      metrics: params.metrics,
      existingPriceControl: params.existingPromotion?.priceControl,
    });

    return { ...params.promotion, priceControl };
  }

  private resolveDealPrice(eligibleItem: EligibleItem, itemDetail: ItemDetail): number {
    return (
      eligibleItem.maxPrice ?? eligibleItem.suggestedPrice ?? eligibleItem.originalPrice ?? itemDetail.price ?? 0
    );
  }

  buildActivationCommand(promotion: Promotion): ActivatePromotionCommand {
    const dealPrice =
      promotion.prices.maxPrice ?? promotion.prices.suggestedPrice ?? promotion.prices.originalPrice;
    if (dealPrice === undefined) {
      throw new Error(`Missing deal price for item ${promotion.itemId}`);
    }

    return {
      promotionId: promotion.promotionId,
      promotionType: PromotionType.DEAL,
      itemId: promotion.itemId,
      dealPrice,
    };
  }

  buildDeactivationCommand(
    promotion: Promotion,
    action: 'pause' | 'delete',
  ): PauseOrDeletePromotionCommand {
    return {
      promotionId: promotion.promotionId,
      promotionType: PromotionType.DEAL,
      itemId: promotion.itemId,
      action,
    };
  }
}
