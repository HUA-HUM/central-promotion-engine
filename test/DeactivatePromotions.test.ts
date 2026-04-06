import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { Promotion, PromotionStatus, PromotionType } from '@core/entities/Promotion';

describe('DeactivatePromotions', () => {
  it('pauses active promotions when current profitability no longer matches rules', async () => {
    const update = jest.fn();
    const pauseOrDeletePromotion = jest.fn().mockResolvedValue({ status: 'paused' });
    const interactor = new DeactivatePromotions({
      promotionRepository: {
        findPendingActivation: async () => [],
        findActive: async () => [
          makePromotion({
            offerId: 'offer-1',
            status: PromotionStatus.ACTIVE,
            economics: { profit: 60, profitability: 0.2, minAllowedProfitability: 0.1 },
          }),
        ],
        saveAll: async () => undefined,
        update,
        findAll: async () => [],
      },
      mercadolibreApiRepository: {
        activatePromotion: async () => ({ status: 'active' }),
        getEligibleItems: async () => [],
        getItemDetail: async () => ({ itemId: 'MLA1', sellerId: 'seller-1' }),
        getPromotions: async () => [],
        pauseOrDeletePromotion,
      },
      priceApiRepository: {
        getCurrentSalePrice: async () => 100,
        getMetrics: async () => ({ profit: -5, profitability: 0.05 }),
      },
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

    expect(pauseOrDeletePromotion).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
  });
});

function makePromotion(partial: Partial<Promotion>): Promotion {
  return {
    promotionId: 'promo-1',
    itemId: 'MLA1',
    sellerId: 'seller-1',
    type: PromotionType.UNKNOWN,
    status: PromotionStatus.ACTIVE,
    prices: {},
    economics: {},
    metadata: {},
    auditTrail: [],
    ...partial,
  };
}
