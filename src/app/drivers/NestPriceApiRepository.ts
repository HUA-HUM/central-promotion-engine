import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  PriceApiRepository,
  PriceMetricsBulkResult,
  PriceMetricsInput,
  PriceMetrics,
  PriceApiGetProfitResponse,
  PriceApiGetProfitBulkResponse,
} from '@core/adapters/repositories/IPriceApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';

const BULK_LIMIT = 50;

@Injectable()
export class NestPriceApiRepository implements PriceApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async getMetrics(input: PriceMetricsInput): Promise<PriceMetrics> {
    const response = await this.post<PriceApiGetProfitResponse>('/internal/getProfit', {
      mla: input.itemId,
      sku: input.sku,
      categoryId: input.categoryId,
      publicationType: input.publicationType,
      salePrice: input.salePrice,
      meliContributionPercentage: input.meliContributionPercentage ?? 0,
    });

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
      const response = await this.post<PriceApiGetProfitBulkResponse[]>('/internal/getProfit/bulk',
        chunk.map((input) => ({
          mla: input.itemId,
          sku: input.sku,
          categoryId: input.categoryId,
          publicationType: input.publicationType,
          salePrice: input.salePrice,
          meliContributionPercentage: input.meliContributionPercentage,
        })),
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const config = this.configService.get();
    const url = `${config.priceApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          timeout: config.priceApiTimeout,
          headers: this.headers(config.priceApiToken),
        }),
      );
      // loggerInfo({
      //   config: {
      //     method: 'POST',
      //     url,
      //     headers: this.headers(config.priceApiToken),
      //     data: body,
      //     message: 'price-api request completed',
      //     services: 'price-api',
      //     status: response.status,
      //     response: response.data,
      //   },
      // });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, 'price-api');
      throw error;
    }
  }

  private headers(apiToken?: string): Record<string, string> {
    return {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ...(apiToken ? { 'x-api-key': apiToken } : {}),
    };
  }
}
