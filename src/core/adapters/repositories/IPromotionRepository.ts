import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionCatalog, PromotionCatalogStatus, PromotionType } from '@core/entities/PromotionCatalog';

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

export interface PromotionCatalogFilters {
  status?: PromotionCatalogStatus;
  type?: PromotionType;
  promotionId?: string;
  name?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedPromotionCatalogsResult {
  items: PromotionCatalog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PromotionStatusBreakdown {
  total: number;
  pending: number;
  active: number;
  paused: number;
  synced: number;
  deleted: number;
  finished: number;
  failedSync: number;
  failedActivation: number;
  failedDeactivation: number;
}

export interface PromotionStatsResult {
  total: number;
  smart: PromotionStatusBreakdown;
  deal: PromotionStatusBreakdown;
  preNegotiated: PromotionStatusBreakdown;
}

export interface PromotionRepository {
  saveAll(promotions: Promotion[]): Promise<void>;
  saveCatalogs(catalogs: PromotionCatalog[]): Promise<void>;
  findPendingActivation(): Promise<Promotion[]>;
  findPendingActivationBatch(afterId?: string, limit?: number): Promise<Promotion[]>;
  findActive(): Promise<Promotion[]>;
  findActiveBatch(afterId?: string, limit?: number): Promise<Promotion[]>;
  findFailedDeactivationBatch(afterId?: string, limit?: number): Promise<Promotion[]>;
  hasActivePromotionForItem(itemId: string, type: PromotionType, excludingPromotionId?: string): Promise<boolean>;
  update(promotion: Promotion): Promise<void>;
  findAll(filters: PromotionFilters): Promise<PaginatedPromotionsResult>;
  findCatalogs(filters: PromotionCatalogFilters): Promise<PaginatedPromotionCatalogsResult>;
  getStats(): Promise<PromotionStatsResult>;
}
