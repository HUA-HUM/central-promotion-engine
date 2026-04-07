import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  PriceApiRepository,
  PriceMetrics,
} from '@core/adapters/repositories/IPriceApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';

@Injectable()
export class NestPriceApiRepository implements PriceApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async getMetrics(input: { itemId: string; salePrice: number }): Promise<PriceMetrics> {
    // TODO: Implementar llamada real a la API de Precio para obtener las métricas del ítem, actualmente se devuelve un objeto simulado para evitar errores en la ejecución del proceso de sincronización. Pendiente arreglar la meli api primero
    return {
      cost: 100,
      profit: 50,
      profitability: 50,
      margin: 33.33,
    }
    return this.post('/profitability/calculate', {
      mla: input.itemId,
      salePrice: input.salePrice,
    });
  }

  async getCurrentSalePrice(itemId: string): Promise<number> {
    const response = await this.get<{ currentSalePrice: number }>(`/items/${itemId}/current-sale-price`);
    return response.currentSalePrice;
  }

  private async get<T>(path: string): Promise<T> {
    const config = this.configService.get();
    const url = `${config.priceApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, {
          timeout: config.priceApiTimeout,
          headers: this.headers(config.priceApiToken),
        }),
      );
      loggerInfo({
        config: {
          method: 'GET',
          url,
          headers: this.headers(config.priceApiToken),
          message: 'price-api request completed',
          services: 'price-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, null, url, 'price-api');
      throw error;
    }
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
      loggerInfo({
        config: {
          method: 'POST',
          url,
          headers: this.headers(config.priceApiToken),
          data: body,
          message: 'price-api request completed',
          services: 'price-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, 'price-api');
      throw error;
    }
  }

  private headers(token?: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
