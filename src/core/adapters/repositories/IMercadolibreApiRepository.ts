import { PromotionStatus, PromotionType } from '@core/entities/Promotion';

export enum MeliPromotionStatus {
  STARTED = 'started',
  PENDIGNG = 'pending',
  CANDIDATE = 'candidate',
}

export interface MeliPaginatedResponse<T> {
  paging: {
    total: number;
    limit: number;
    offset?: number;
    searchAfter?: string;
  };
  results: T[];
}

export interface MeliPromotionCatalog {
  id: string;
  type: PromotionType;
  status: PromotionStatus;
  start_date?: Date;
  finish_date?: Date;
  deadline_date?: Date;
  name?: string;
  sub_type?: string;
  fixed_amount?: number;
  min_purchase_amount?: number;
}

export interface MeliEligibleItem {
  id: string;
  status: MeliPromotionStatus;
  original_price: number;
  min_discounted_price: number;
  max_discounted_price: number;
  suggested_discounted_price: number;
}


export interface PromotionCatalog {
  promotionId: string;
  type: PromotionType;
  status: PromotionStatus;
  startDate?: Date;
  finishDate?: Date;
  deadlineDate?: Date;
  name?: string;
  subType?: string;
  fixedAmount?: number;
  minPurchaseAmount?: number;
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
  getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]>;
  getElegibleItemsPaginated(promotionId: string, promotionType: string, searchAfter?: string): Promise<MeliPaginatedResponse<EligibleItem>>;
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
