import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { Promotion, PromotionStatus, PromotionType } from '@core/entities/Promotion';

describe('ActivatePromotions', () => {
  it('activates only promotions that satisfy profitability rules', async () => {
    const update = jest.fn();
    const activatePromotion = jest.fn().mockResolvedValue({ offerId: 'offer-1', status: 'active' });
    const interactor = new ActivatePromotions({
      promotionRepository: {
        findPendingActivation: async () => [
          makePromotion({ itemId: 'MLA1', economics: { profit: 50, profitability: 0.2, minAllowedProfitability: 0.1 } }),
          makePromotion({ itemId: 'MLA2', economics: { profit: -10, profitability: 0.05, minAllowedProfitability: 0.1 } }),
        ],
        findActive: async () => [],
        saveAll: async () => undefined,
        update,
        findAll: async () => [],
      },
      mercadolibreApiRepository: {
        activatePromotion,
        getEligibleItems: async () => [],
        getItemDetail: async () => ({ itemId: 'MLA1'}),
        getPromotions: async () => [],
        pauseOrDeletePromotion: async () => ({ status: 'paused' }),
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

    expect(activatePromotion).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

function makePromotion(partial: Partial<Promotion>): Promotion {
  return {
    promotionId: 'promo-1',
    itemId: 'MLA1',
    type: PromotionType.UNKNOWN,
    status: PromotionStatus.SYNCED,
    prices: {},
    economics: {},
    metadata: {},
    auditTrail: [],
    ...partial,
  };
}
