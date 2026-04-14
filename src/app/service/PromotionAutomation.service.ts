import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { Logger } from '@core/drivers/logger/Logger';

@Injectable()
export class PromotionAutomationService implements OnApplicationBootstrap {
  private syncRunning = false;
  private activateRunning = false;
  private deactivateRunning = false;

  constructor(
    private readonly configService: AppConfigService,
    @Inject('SyncAllPromotions')
    private readonly syncAllPromotions: SyncAllPromotions,
    @Inject('ActivatePromotions')
    private readonly activatePromotions: ActivatePromotions,
    @Inject('DeactivatePromotions')
    private readonly deactivatePromotions: DeactivatePromotions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Disabled on bootstrap. Cron handlers run automation processes.
  }

  @Cron(process.env.SYNC_PROMOTIONS_CRON || '0 0 */12 * * *')
  async handleSyncCron(): Promise<void> {
    await this.triggerSync('cron.sync');
  }

  @Cron(process.env.ACTIVATE_PROMOTIONS_CRON || '0 0 */8 * * *')
  async handleActivateCron(): Promise<void> {
    await this.triggerActivate('cron.activate');
  }

  @Cron(process.env.DEACTIVATE_PROMOTIONS_CRON || '0 0 */10 * * *')
  async handleDeactivateCron(): Promise<void> {
    await this.triggerDeactivate('cron.deactivate');
  }

  async triggerSync(sourceProcess: string): Promise<void> {
    await this.runSingleWorker('sync', sourceProcess, async () => {
      this.syncRunning = true;
      await this.syncAllPromotions.execute({ sourceProcess, updatedBy: 'scheduler' });
      this.syncRunning = false;
    });
  }

  async triggerActivate(sourceProcess: string): Promise<void> {
    await this.runSingleWorker('activate', sourceProcess, async () => {
      this.activateRunning = true;
      await this.activatePromotions.execute({ sourceProcess, updatedBy: 'scheduler' });
      this.activateRunning = false;
    });
  }

  async triggerDeactivate(sourceProcess: string): Promise<void> {
    await this.runSingleWorker('deactivate', sourceProcess, async () => {
      this.deactivateRunning = true;
      await this.deactivatePromotions.execute({ sourceProcess, updatedBy: 'scheduler' });
      this.deactivateRunning = false;
    });
  }

  private async runSingleWorker(
    process: 'sync' | 'activate' | 'deactivate',
    sourceProcess: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const isRunning =
      process === 'sync'
        ? this.syncRunning
        : process === 'activate'
          ? this.activateRunning
          : this.deactivateRunning;

    if (isRunning) {
      Logger.info(
        JSON.stringify({
          message: 'Skipping overlapping automation run',
          process,
          sourceProcess,
        }),
      );
      return;
    }

    try {
      Logger.info(
        JSON.stringify({
          message: 'Starting automation run',
          process,
          sourceProcess,
          schedule: this.resolveCron(process),
        }),
      );
      await run();
    } finally {
      if (process === 'sync') {
        this.syncRunning = false;
      }
      if (process === 'activate') {
        this.activateRunning = false;
      }
      if (process === 'deactivate') {
        this.deactivateRunning = false;
      }
    }
  }

  private resolveCron(process: 'sync' | 'activate' | 'deactivate'): string {
    const config = this.configService.get();
    if (process === 'sync') {
      return config.syncCron;
    }
    if (process === 'activate') {
      return config.activateCron;
    }
    return config.deactivateCron;
  }
}
