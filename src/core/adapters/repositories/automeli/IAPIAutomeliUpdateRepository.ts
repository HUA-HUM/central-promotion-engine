import {
  AutomeliAppStatusCommand,
  AutomeliAppStatusResponse,
} from '@core/adapters/repositories/automeli/AutomeliAppStatusRepository';

export interface IAPIAutomeliUpdateRepository {
  update(command: AutomeliAppStatusCommand): Promise<AutomeliAppStatusResponse>;
}

export interface IAPIAutomeliEnableUpdateRepository {
  enableUpdate(command: AutomeliAppStatusCommand): Promise<AutomeliAppStatusResponse>;
}
