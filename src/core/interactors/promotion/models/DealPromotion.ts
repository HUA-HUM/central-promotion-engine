import { PromotionType } from '@core/entities/PromotionCatalog';
import { Promotion } from '@core/entities/Promotion';
import { ActivatePromotionCommand } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { GenericPromotion } from '@core/interactors/promotion/models/Promotion';

export class DealPromotion extends GenericPromotion {
  readonly type = PromotionType.DEAL;

  buildActivationCommand(promotion: Promotion): ActivatePromotionCommand {
    const dealPrice = promotion.prices.suggestedPrice ?? promotion.prices.originalPrice;
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
}
