import { Promotion } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import {
  ActivatePromotionCommand,
  PauseOrDeletePromotionCommand,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import {
  GenericPromotion,
  PromotionBuilderInput,
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
