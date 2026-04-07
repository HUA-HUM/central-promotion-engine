import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog } from '@core/entities/PromotionCatalog';

export interface PromotionFilters {
  status?: PromotionStatus;
  sellerId?: string;
  itemId?: string;
  limit?: number;
}

export interface PromotionRepository {
  saveAll(promotions: Promotion[]): Promise<void>;
  saveCatalogs(catalogs: PromotionCatalog[]): Promise<void>;
  findPendingActivation(): Promise<Promotion[]>;
  findActive(): Promise<Promotion[]>;
  update(promotion: Promotion): Promise<void>;
  findAll(filters: PromotionFilters): Promise<Promotion[]>;
}
