import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog } from '@core/entities/PromotionCatalog';

export interface PromotionFilters {
  status?: PromotionStatus;
  statuses?: PromotionStatus[];
  itemId?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedPromotionsResult {
  items: Promotion[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PromotionRepository {
  saveAll(promotions: Promotion[]): Promise<void>;
  saveCatalogs(catalogs: PromotionCatalog[]): Promise<void>;
  findPendingActivation(): Promise<Promotion[]>;
  findPendingActivationBatch(afterId?: string, limit?: number): Promise<Promotion[]>;
  findActive(): Promise<Promotion[]>;
  update(promotion: Promotion): Promise<void>;
  findAll(filters: PromotionFilters): Promise<PaginatedPromotionsResult>;
}
