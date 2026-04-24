import {
  PriceApiGetProfitBulkResponse,
  PriceApiGetProfitResponse,
  IAPIPriceApiRepository,
  PriceMetrics,
  PriceMetricsBulkResult,
  PriceMetricsInput,
} from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { APIHttpClient } from '@core/drivers/repositories/http/APIHttpClient';
import { AxiosInstance } from 'axios';

const BULK_LIMIT = 50;

export interface APIPriceApiRepositoryConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  apiToken?: string;
}

export class APIPriceApiRepository extends APIHttpClient implements IAPIPriceApiRepository {
  constructor(private readonly repositoryConfig: APIPriceApiRepositoryConfig) {
    super({
      axios: repositoryConfig.axios,
      baseUrl: repositoryConfig.baseUrl,
      timeout: repositoryConfig.timeout,
      service: 'price-api',
    });
  }

  async getMetrics(input: PriceMetricsInput): Promise<PriceMetrics> {
    const response = await this.post<PriceApiGetProfitResponse>(
      '/internal/getProfit',
      {
        mla: input.itemId,
        sku: input.sku,
        categoryId: input.categoryId,
        publicationType: input.publicationType,
        salePrice: input.salePrice,
        meliContributionPercentage: input.meliContributionPercentage ?? 0,
      },
      { headers: this.headers() },
    );

    return {
      cost: response.economics?.cost,
      profit: response.economics?.profitAmount,
      profitability: response.economics?.profitabilityPercent,
      margin: response.economics?.marginPercent,
      profitable: response.status?.profitable,
      shouldPause: response.status?.shouldPause,
    };
  }

  async getMetricsBulk(inputs: PriceMetricsInput[]): Promise<PriceMetricsBulkResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const results: PriceMetricsBulkResult[] = [];

    for (let index = 0; index < inputs.length; index += BULK_LIMIT) {
      const chunk = inputs.slice(index, index + BULK_LIMIT);
      const response = await this.post<PriceApiGetProfitBulkResponse[]>(
        '/internal/getProfit/bulk',
        chunk.map((input) => ({
          mla: input.itemId,
          sku: input.sku,
          categoryId: input.categoryId,
          publicationType: input.publicationType,
          salePrice: input.salePrice,
          meliContributionPercentage: input.meliContributionPercentage,
        })),
        { headers: this.headers() },
      );

      for (const item of response ?? []) {
        if (!item.input?.mla || !item.input.categoryId || !item.input.publicationType) {
          continue;
        }

        results.push({
          input: {
            itemId: item.input.mla,
            sku: item.input.sku,
            categoryId: item.input.categoryId,
            publicationType: item.input.publicationType,
            salePrice: item.input.salePrice ?? 0,
            meliContributionPercentage: item.input.meliContributionPercentage,
          },
          metrics: {
            cost: item.economics?.cost,
            profit: item.economics?.profitAmount,
            profitability: item.economics?.profitabilityPercent,
            margin: item.economics?.marginPercent,
            profitable: item.status?.profitable,
            shouldPause: item.status?.shouldPause,
          },
        });
      }
    }

    return results;
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ...(this.repositoryConfig.apiToken ? { 'x-api-key': this.repositoryConfig.apiToken } : {}),
    };
  }
}
