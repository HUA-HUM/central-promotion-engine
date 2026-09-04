import { ItemDetail } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';

export interface CatalogMeliLookupResult {
  products: ItemDetail[];
  notFound: string[];
}

export interface IAPICatalogMeliApiRepository {
  lookupItemDetails(itemIds: string[]): Promise<CatalogMeliLookupResult>;
}
