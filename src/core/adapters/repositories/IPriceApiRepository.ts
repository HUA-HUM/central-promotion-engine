export interface PriceMetrics {
  cost?: number;
  profit?: number;
  profitability?: number;
  margin?: number;
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
