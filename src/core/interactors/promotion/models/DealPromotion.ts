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

  buildDeactivationCommand(
    promotion: Promotion,
    action: 'pause' | 'delete',
  ): PauseOrDeletePromotionCommand {
    if (!promotion.offerId) {
      throw new Error(`Missing offerId for active DEAL promotion on item ${promotion.itemId}`);
    }

    return {
      promotionId: promotion.promotionId,
      promotionType: PromotionType.DEAL,
      itemId: promotion.itemId,
      offerId: promotion.offerId,
      action,
    };
  }
}
