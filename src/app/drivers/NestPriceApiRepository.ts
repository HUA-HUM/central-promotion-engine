import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  PriceApiRepository,
  PriceMetricsInput,
  PriceMetrics,
} from '@core/adapters/repositories/IPriceApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';

interface PriceApiGetProfitResponse {
  economics?: {
    cost?: number;
    profitAmount?: number;
    profitabilityPercent?: number;
    marginPercent?: number;
  };
}

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
      profitability: this.percentToRatio(response.economics?.profitabilityPercent),
      margin: this.percentToRatio(response.economics?.marginPercent),
    };
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

  private percentToRatio(value?: number): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    return value / 100;
  }
}
