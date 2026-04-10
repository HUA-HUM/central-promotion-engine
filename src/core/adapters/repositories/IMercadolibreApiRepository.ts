import { PromotionCatalogStatus } from '@core/entities/PromotionCatalog';
import { PromotionType } from '@core/entities/PromotionCatalog';

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
  name: string;
  id: string;
  type: PromotionType;
  status: PromotionCatalogStatus;
  start_date?: Date;
  finish_date?: Date;
  deadline_date?: Date;
  sub_type?: string;
  fixed_amount?: number;
  min_purchase_amount?: number;
}

export interface MeliEligibleItem {
  id: string;
  status: MeliPromotionStatus;
  original_price: number;
  // DEAL
  suggested_discounted_price: number;
  min_discounted_price?: number;
  max_discounted_price?: number;
  // SMART
  offer_id?: string;
  price?: number;
  meli_percentage?: number;
  seller_percentage?: number;
  // PRE_NEGOTIATED
}

export interface MeliItemDetail {
  id: string;
  sellerSku: string;
  categoryId: string;
  price: number;
  listingTypeId: string;
}

export interface PromotionCatalog {
  name: string;
  promotionId: string;
  type: PromotionType;
  status: PromotionCatalogStatus;
  startDate?: Date;
  finishDate?: Date;
  deadlineDate?: Date;
  subType?: string;
  fixedAmount?: number;
  minPurchaseAmount?: number;
}

export interface EligibleItem {
  itemId: string;
  status: MeliPromotionStatus;
  offerId?: string;
  originalPrice: number;
  suggestedPrice: number;
  minPrice?: number;
  maxPrice?: number;
  meliPercentage?: number;
  sellerPercentage?: number;
}

export interface ItemDetail {
  itemId: string;
  sku: string;
  categoryId: string;
  listingTypeId: string;
  price: number;
}

export interface MercadolibreApiRepository {
  getPromotions(): Promise<PromotionCatalog[]>;
  getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]>;
  getElegibleItemsPaginated(promotionId: string, promotionType: string, searchAfter?: string): Promise<MeliPaginatedResponse<EligibleItem>>;
  getItemDetail(itemId: string): Promise<ItemDetail>;
  activatePromotion(command: {
    promotionId: string;
    itemId: string;
  }): Promise<{ offerId?: string; status: string }>;
  pauseOrDeletePromotion(command: {
    promotionId: string;
    itemId: string;
    offerId?: string;
    action: 'pause' | 'delete';
  }): Promise<{ status: string }>;
}
