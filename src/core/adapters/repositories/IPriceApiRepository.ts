export interface PriceMetrics {
  cost?: number;
  profit?: number;
  profitability?: number;
  margin?: number;
  profitable?: boolean;
  shouldPause?: boolean;
}

export interface PriceMetricsInput {
  itemId: string;
  sku?: string;
  categoryId: string;
  publicationType: string;
  salePrice: number;
  meliContributionPercentage?: number;
}

export interface PriceApiRepository {
  getMetrics(input: PriceMetricsInput): Promise<PriceMetrics>;
}
