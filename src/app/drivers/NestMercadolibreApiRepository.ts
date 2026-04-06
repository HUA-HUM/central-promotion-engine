import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  EligibleItem,
  ItemDetail,
  MercadolibreApiRepository,
  PromotionCatalog,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';

@Injectable()
export class NestMercadolibreApiRepository implements MercadolibreApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async getPromotions(): Promise<PromotionCatalog[]> {
    return this.get('/promotions');
  }

  async getEligibleItems(promotionId: string): Promise<EligibleItem[]> {
    return this.get(`/promotions/${promotionId}/eligible-items`);
  }

  async getItemDetail(itemId: string): Promise<ItemDetail> {
    return this.get(`/items/${itemId}`);
  }

  async activatePromotion(command: {
    promotionId: string;
    itemId: string;
    sellerId: string;
  }): Promise<{ offerId?: string; status: string }> {
    return this.post('/promotions/activate', command);
  }

  async pauseOrDeletePromotion(command: {
    promotionId: string;
    itemId: string;
    sellerId: string;
    offerId?: string;
    action: 'pause' | 'delete';
  }): Promise<{ status: string }> {
    return this.post('/promotions/deactivate', command);
  }

  private async get<T>(path: string): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
        }),
      );
      loggerInfo({
        config: {
          method: 'GET',
          url,
          headers: this.headers(config.mercadolibreApiToken),
          message: 'mercadolibre-api request completed',
          services: 'mercadolibre-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, null, url, 'mercadolibre-api');
      throw error;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
        }),
      );
      loggerInfo({
        config: {
          method: 'POST',
          url,
          headers: this.headers(config.mercadolibreApiToken),
          data: body,
          message: 'mercadolibre-api request completed',
          services: 'mercadolibre-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, 'mercadolibre-api');
      throw error;
    }
  }

  private headers(token?: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
