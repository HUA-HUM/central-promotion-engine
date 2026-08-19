export interface AppConfig {
  port: number;
  serviceName: string;
  mongoUrl: string;
  campaignMlaApiBaseUrl: string;
  campaignMlaApiTimeout: number;
  campaignMlaApiToken?: string;
  syncPromotionTypes: string[];
  mercadolibreApiBaseUrl: string;
  mercadolibreApiTimeout: number;
  mercadolibreApiToken?: string;
  mercadolibreAppKey: string;
  priceApiBaseUrl: string;
  priceApiTimeout: number;
  priceApiToken?: string;
  syncCron: string;
  activateCron: string;
  deactivateCron: string;
  defaultMinProfitability: number;
  defaultMinProfit: number;
  syncPromotion: string;
  automeliApiBaseUrl: string;
  automeliApiTimeout: number;
  automeliApiToken?: string;
  automeliSellerId: number;
}
