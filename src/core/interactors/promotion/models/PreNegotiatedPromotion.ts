import { Promotion } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { Terms } from '@core/entities/Terms';
import {
  ActivatePromotionCommand,
  PauseOrDeletePromotionCommand,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import {
  GenericPromotion,
  PromotionBuilderInput,
} from '@core/interactors/promotion/models/Promotion';

export class PreNegotiatedPromotion extends GenericPromotion {
  readonly type = PromotionType.PRE_NEGOTIATED;

  async build(command: PromotionBuilderInput): Promise<Promotion> {
    const basePromotion = await this.buildBasePromotion(command);
    return {
      ...basePromotion,
      offerId: command.eligibleItem.offerId,
      terms: this.buildTerms(command),
    };
  }

  private buildTerms(command: PromotionBuilderInput): Terms {
    const { eligibleItem } = command;

    return {
      resignation: {
        mercadolibre: {
          percentage: eligibleItem.meliPercentage,
          amount: eligibleItem.originalPrice * (eligibleItem.meliPercentage ?? 0) / 100,
        },
        seller: {
          percentage: eligibleItem.sellerPercentage,
          amount: eligibleItem.originalPrice * (eligibleItem.sellerPercentage ?? 0) / 100,
        },
        total: (eligibleItem.meliPercentage ?? 0) + (eligibleItem.sellerPercentage ?? 0),
      },
      pvp: {
        current: {},
        revenue: {},
        store: {},
      },
    };
  }

  buildActivationCommand(promotion: Promotion): ActivatePromotionCommand {
    return {
      promotionId: promotion.promotionId,
      promotionType: PromotionType.PRE_NEGOTIATED,
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
      promotionType: PromotionType.PRE_NEGOTIATED,
      itemId: promotion.itemId,
      offerId: promotion.offerId,
      action,
    };
  }
}
