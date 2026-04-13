import { Promotion } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { Terms } from '@core/entities/Terms';
import {
  GenericPromotionBuilder,
  PromotionBuilderInput,
} from '@core/interactors/promotion/builders/PromotionBuilder';

export class SmartPromotionBuilder extends GenericPromotionBuilder {
  readonly type = PromotionType.SMART;

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
}
