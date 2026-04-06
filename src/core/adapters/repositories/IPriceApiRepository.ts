export interface PriceMetrics {
  cost?: number;
  profit?: number;
  profitability?: number;
  margin?: number;
}

export interface PriceApiRepository {
  getMetrics(input: { itemId: string; salePrice: number }): Promise<PriceMetrics>;
  getCurrentSalePrice(itemId: string): Promise<number>;
}
