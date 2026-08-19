export type AutomeliAppStatus = 'enabled' | 'meli_excluded' | 'disabled';

export interface AutomeliAppStatusCommand {
  sellerId: number;
  listingIds: string[];
  includeNotFound?: boolean;
}

export interface AutomeliAppStatusResponse {
  status: AutomeliAppStatus;
  requested: number;
  updated: number;
  matched?: number;
  notFound?: string[];
}
