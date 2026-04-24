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

export interface PriceMetricsBulkResult {
  input: PriceMetricsInput;
  metrics: PriceMetrics;
}

export interface PriceApiGetProfitResponse {
  economics?: {
    cost?: number;
    profitAmount?: number;
    profitabilityPercent?: number;
    marginPercent?: number;
  };
  status?: {
    profitable?: boolean;
    shouldPause?: boolean;
  };
}

export interface PriceApiGetProfitBulkResponse {
  input?: {
    mla?: string;
    sku?: string;
    categoryId?: string;
    publicationType?: string;
    salePrice?: number;
    meliContributionPercentage?: number;
  };
  economics?: {
    cost?: number;
    profitAmount?: number;
    profitabilityPercent?: number;
    marginPercent?: number;
  };
  status?: {
    profitable?: boolean;
    shouldPause?: boolean;
  };
}

export interface IAPIPriceApiRepository {
  getMetrics(input: PriceMetricsInput): Promise<PriceMetrics>;
  getMetricsBulk(inputs: PriceMetricsInput[]): Promise<PriceMetricsBulkResult[]>;
}
