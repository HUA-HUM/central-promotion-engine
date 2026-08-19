import { IAPIAutomeliUpdateRepository, IAPIAutomeliEnableUpdateRepository } from '@core/adapters/repositories/automeli/IAPIAutomeliUpdateRepository';
import { AutomeliAppStatusResponse } from '@core/adapters/repositories/automeli/AutomeliAppStatusRepository';

export interface AutomeliMlaControlInput {
  listingIds: string[];
}

export interface AutomeliMlaControlBuilder {
  automeliUpdateRepository: IAPIAutomeliUpdateRepository;
  automeliEnableUpdateRepository: IAPIAutomeliEnableUpdateRepository;
  config: { automeliSellerId: number };
}

export class AutomeliMlaControl {
  constructor(private readonly builder: AutomeliMlaControlBuilder) {}

  async exclude(input: AutomeliMlaControlInput): Promise<AutomeliAppStatusResponse> {
    return this.builder.automeliUpdateRepository.update({
      sellerId: this.builder.config.automeliSellerId,
      listingIds: input.listingIds,
      includeNotFound: true,
    });
  }

  async include(input: AutomeliMlaControlInput): Promise<AutomeliAppStatusResponse> {
    return this.builder.automeliEnableUpdateRepository.enableUpdate({
      sellerId: this.builder.config.automeliSellerId,
      listingIds: input.listingIds,
      includeNotFound: true,
    });
  }
}
