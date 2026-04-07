import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  EligibleItem,
  ItemDetail,
  MercadolibreApiRepository,
  PromotionCatalog,
  MeliPaginatedResponse,
  MeliPromotionCatalog,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';
import { PaginationParams, PaginatedResult } from '@core/entities/common/Pagination';

@Injectable()
export class NestMercadolibreApiRepository implements MercadolibreApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async getPromotions(): Promise<PromotionCatalog[]> {
    const promotionCatalogs: PromotionCatalog[] = [];
    const pagination: PaginationParams = { limit: 50, offset: 0 };
    const res = await this.get<MeliPaginatedResponse<MeliPromotionCatalog>>('/meli/seller-promotions?' + new URLSearchParams({
      limit: pagination.limit.toString(),
      offset: pagination.offset.toString(),
    }));
    // TODO: Implementar lógica de paginación utilizando res.paging, pendiente arreglar la meli api primero
    res.results.forEach((promotion) => {
      promotionCatalogs.push({
        promotionId: promotion.id,
        type: promotion.type,
        status: promotion.status,
        startDate: promotion.start_date,
        finishDate: promotion.finish_date,
        deadlineDate: promotion.deadline_date,
        name: promotion.name,
        subType: promotion.sub_type,
        fixedAmount: promotion.fixed_amount,
        minPurchaseAmount: promotion.min_purchase_amount,
      });
    });
    return promotionCatalogs;
  }

  async getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]> {
    try {
      const response = await this.get<MeliPaginatedResponse<EligibleItem>>(`/meli/seller-promotions/${promotionId}/items?promotionType=${promotionType}`);
      // TODO: Implementar lógica de paginación utilizando response.paging
      return response.results;
    } catch (error) {
      console.log('catch error in getEligibleItems for promotionId', promotionId);
      return [];
    }
  }

  async getItemDetail(itemId: string): Promise<ItemDetail> {
    // TODO: Implementar llamada real a la API de MercadoLibre para obtener los detalles del ítem, actualmente se devuelve un objeto simulado para evitar errores en la ejecución del proceso de sincronización. Pendiente arreglar la meli api primero
    return {
      itemId,
      sellerId: 'unknown',
    }
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
      // loggerInfo({
      //   config: {
      //     method: 'GET',
      //     url,
      //     headers: this.headers(config.mercadolibreApiToken),
      //     message: 'mercadolibre-api request completed',
      //     services: 'mercadolibre-api',
      //     status: response.status,
      //     response: response.data,
      //   },
      // });
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
    return token ? { 'x-internal-api-key': `${token}` } : {};
  }
}
