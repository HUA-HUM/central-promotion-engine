import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { GetPromotions } from '@core/interactors/promotion/GetPromotions';
import { GetPromotionCatalogs } from '@core/interactors/promotion/GetPromotionCatalogs';
import { GetPromotionStats } from '@core/interactors/promotion/GetPromotionStats';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { SyncOnePromotion } from '@core/interactors/promotion/SyncOnePromotion';
import { GetPromotionsDto } from '@app/controller/promotions/GetPromotions.dto';
import { GetPromotionCatalogsDto } from '@app/controller/promotions/GetPromotionCatalogs.dto';
import { RunProcessDto } from '@app/controller/promotions/RunProcess.dto';
import { SyncOnePromotionDto } from '@app/controller/promotions/SyncOnePromotion.dto';
import { PromotionStatus } from '@core/entities/Promotion';

@Controller('promotions')
export class PromotionsController {
  constructor(
    @Inject('GetPromotions')
    private readonly getPromotions: GetPromotions,
    @Inject('GetPromotionCatalogs')
    private readonly getPromotionCatalogs: GetPromotionCatalogs,
    @Inject('GetPromotionStats')
    private readonly getPromotionStats: GetPromotionStats,
    @Inject('SyncAllPromotions')
    private readonly syncAllPromotions: SyncAllPromotions,
    @Inject('SyncOnePromotion')
    private readonly syncOnePromotion: SyncOnePromotion,
    @Inject('ActivatePromotions')
    private readonly activatePromotions: ActivatePromotions,
    @Inject('DeactivatePromotions')
    private readonly deactivatePromotions: DeactivatePromotions,
  ) {}

  @Get()
  async list(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters(query);
  }

  @Get('catalogs')
  async listCatalogs(@Query() query: GetPromotionCatalogsDto) {
    return this.getPromotionCatalogs.findWithFilters(query);
  }

  @Get('stats')
  async stats() {
    return this.getPromotionStats.execute();
  }

  @Get('active')
  async listActive(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters({
      ...query,
      status: PromotionStatus.ACTIVE,
    });
  }

  @Get('failed')
  async listFailed(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters({
      ...query,
      statuses: [
        PromotionStatus.FAILED_SYNC,
        PromotionStatus.FAILED_ACTIVATION,
        PromotionStatus.FAILED_DEACTIVATION,
      ],
      status: undefined,
    });
  }

  @Get('skipped')
  async listSkipped() {
    throw new BadRequestException(
      'Skipped promotions are not persisted as a status yet, so they cannot be listed with pagination.',
    );
  }

  @Post('sync')
  async sync(@Body() body: RunProcessDto) {
    return this.syncAllPromotions.execute({
      sourceProcess: 'manual-sync',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @Post('sync-one')
  async syncOne(@Body() body: SyncOnePromotionDto) {
    return this.syncOnePromotion.execute({
      promotionId: body.promotionId,
      sourceProcess: 'manual-sync-one',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @Post('activate')
  async activate(@Body() body: RunProcessDto) {
    return this.activatePromotions.execute({
      sourceProcess: 'manual-activate',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @Post('deactivate')
  async deactivate(@Body() body: RunProcessDto) {
    return this.deactivatePromotions.execute({
      sourceProcess: 'manual-deactivate',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @Post('deactivate-failed')
  async deactivateFailed(@Body() body: RunProcessDto) {
    return this.deactivatePromotions.retryFailed({
      sourceProcess: 'manual-deactivate-failed',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }
}
