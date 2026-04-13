import { PromotionType } from '@core/entities/PromotionCatalog';
import { GenericPromotionBuilder } from '@core/interactors/promotion/builders/PromotionBuilder';

export class DealPromotionBuilder extends GenericPromotionBuilder {
  readonly type = PromotionType.DEAL;
}
