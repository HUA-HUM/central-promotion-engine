export interface AppConfig {
  port: number;
  serviceName: string;
  mongoUrl: string;
  campaignMlaApiBaseUrl: string;
  campaignMlaApiTimeout: number;
  campaignMlaApiToken?: string;
  mercadolibreApiBaseUrl: string;
  mercadolibreApiTimeout: number;
  mercadolibreApiToken?: string;
  priceApiBaseUrl: string;
  priceApiTimeout: number;
  priceApiToken?: string;
  syncCron: string;
  activateCron: string;
  deactivateCron: string;
  defaultMinProfitability: number;
  defaultMinProfit: number;
}
