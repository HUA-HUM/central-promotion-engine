import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';

describe('SyncAllPromotions', () => {
  it('syncs and persists enriched promotions', async () => {
    const saveAll = jest.fn();
    const interactor = new SyncAllPromotions({
      mercadolibreApiRepository: {
        getPromotions: async () => [{ promotionId: 'promo-1', sellerId: 'seller-1' }],
        getEligibleItems: async () => [
          { itemId: 'MLA1', sellerId: 'seller-1', suggestedPrice: 120, listPrice: 150 },
        ],
        getItemDetail: async () => ({ itemId: 'MLA1', sellerId: 'seller-1', listPrice: 150 }),
        activatePromotion: async () => ({ status: 'active' }),
        pauseOrDeletePromotion: async () => ({ status: 'paused' }),
      },
      priceApiRepository: {
        getMetrics: async () => ({ cost: 80, profit: 40, profitability: 0.2, margin: 0.33 }),
        getCurrentSalePrice: async () => 110,
      },
      saveAllPromotion: {
        saveAll,
      } as unknown as SaveAllPromotion,
      config: {
        port: 3000,
        serviceName: 'test',
        mongoUrl: 'mongodb://localhost/test',
        mercadolibreApiBaseUrl: '',
        mercadolibreApiTimeout: 0,
        priceApiBaseUrl: '',
        priceApiTimeout: 0,
        syncCron: '',
        activateCron: '',
        deactivateCron: '',
        defaultMinProfitability: 0.1,
        defaultMinProfit: 0,
      },
    });

    const result = await interactor.execute({
      sourceProcess: 'unit-test',
      updatedBy: 'jest',
    });

    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
    expect(result.failure).toBe(0);
  });
});
