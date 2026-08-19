import {
  IAPIAutomeliUpdateRepository,
  IAPIAutomeliEnableUpdateRepository,
} from '@core/adapters/repositories/automeli/IAPIAutomeliUpdateRepository';
import {
  AutomeliAppStatusCommand,
  AutomeliAppStatusResponse,
} from '@core/adapters/repositories/automeli/AutomeliAppStatusRepository';
import { APIAutomeliAppStatusRepository } from '@core/drivers/repositories/automeli/APIAutomeliAppStatusRepository';

export class APIAutomeliUpdateRepository
  extends APIAutomeliAppStatusRepository
  implements IAPIAutomeliUpdateRepository
{
  async update(command: AutomeliAppStatusCommand): Promise<AutomeliAppStatusResponse> {
    return this.updateStatus(command, 'meli_excluded');
  }
}

export class APIAutomeliEnableUpdateRepository
  extends APIAutomeliAppStatusRepository
  implements IAPIAutomeliEnableUpdateRepository
{
  async enableUpdate(command: AutomeliAppStatusCommand): Promise<AutomeliAppStatusResponse> {
    return this.updateStatus(command, 'enabled');
  }
}
