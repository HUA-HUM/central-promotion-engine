import {
  PriceApiRepository,
  PriceMetrics,
  PriceMetricsInput,
} from '@core/adapters/repositories/IPriceApiRepository';

export interface PriceMetricsRequest<TContext> {
  context: TContext;
  input: PriceMetricsInput;
}

export interface PriceMetricsResolvedRequest<TContext> {
  context: TContext;
  input: PriceMetricsInput;
  metrics?: PriceMetrics;
  error?: Error;
}

export const buildPriceMetricsKey = (input: PriceMetricsInput): string =>
  [
    input.itemId,
    input.sku ?? '',
    input.categoryId,
    input.publicationType,
    String(input.salePrice),
    String(input.meliContributionPercentage ?? ''),
  ].join('|');

export class PriceMetricsBulkResolver {
  constructor(private readonly priceApiRepository: PriceApiRepository) {}

  async resolve<TContext>(
    requests: PriceMetricsRequest<TContext>[],
  ): Promise<PriceMetricsResolvedRequest<TContext>[]> {
    if (requests.length === 0) {
      return [];
    }

    const bulkMetricsByKey = new Map<string, PriceMetrics>();

    try {
      const bulkResponse = await this.priceApiRepository.getMetricsBulk(
        requests.map((request) => request.input),
      );

      for (const result of bulkResponse) {
        bulkMetricsByKey.set(buildPriceMetricsKey(result.input), result.metrics);
      }
    } catch {
      // Fallback to single item requests below.
    }

    const resolved: PriceMetricsResolvedRequest<TContext>[] = [];

    for (const request of requests) {
      const key = buildPriceMetricsKey(request.input);
      const bulkMetrics = bulkMetricsByKey.get(key);

      if (bulkMetrics) {
        resolved.push({
          context: request.context,
          input: request.input,
          metrics: bulkMetrics,
        });
        continue;
      }

      try {
        const metrics = await this.priceApiRepository.getMetrics(request.input);
        resolved.push({
          context: request.context,
          input: request.input,
          metrics,
        });
      } catch (error) {
        resolved.push({
          context: request.context,
          input: request.input,
          error: error instanceof Error ? error : new Error('Unknown metrics error'),
        });
      }
    }

    return resolved;
  }
}
