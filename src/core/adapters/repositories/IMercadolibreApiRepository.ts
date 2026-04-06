import { PromotionType } from '@core/entities/Promotion';

export interface PromotionCatalog {
  promotionId: string;
  sellerId: string;
  type?: PromotionType;
}

export interface EligibleItem {
  itemId: string;
  sellerId: string;
  suggestedPrice: number;
  listPrice?: number;
  strikethroughPrice?: number;
}

export interface ItemDetail {
  itemId: string;
  sellerId: string;
  listPrice?: number;
  suggestedPrice?: number;
  strikethroughPrice?: number;
}

export interface MercadolibreApiRepository {
  getPromotions(): Promise<PromotionCatalog[]>;
  getEligibleItems(promotionId: string): Promise<EligibleItem[]>;
  getItemDetail(itemId: string): Promise<ItemDetail>;
  activatePromotion(command: {
    promotionId: string;
    itemId: string;
    sellerId: string;
  }): Promise<{ offerId?: string; status: string }>;
  pauseOrDeletePromotion(command: {
    promotionId: string;
    itemId: string;
    sellerId: string;
    offerId?: string;
    action: 'pause' | 'delete';
  }): Promise<{ status: string }>;
}
