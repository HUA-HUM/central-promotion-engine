import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { GetPromotions } from '@core/interactors/promotion/GetPromotions';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { GetPromotionsDto } from '@app/controller/promotions/GetPromotions.dto';
import { RunProcessDto } from '@app/controller/promotions/RunProcess.dto';

@Controller('promotions')
export class PromotionsController {
  constructor(
    @Inject('GetPromotions')
    private readonly getPromotions: GetPromotions,
    @Inject('SyncAllPromotions')
    private readonly syncAllPromotions: SyncAllPromotions,
    @Inject('ActivatePromotions')
    private readonly activatePromotions: ActivatePromotions,
    @Inject('DeactivatePromotions')
    private readonly deactivatePromotions: DeactivatePromotions,
  ) {}

  @Get()
  async list(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters(query);
  }

  @Post('sync')
  async sync(@Body() body: RunProcessDto) {
    return this.syncAllPromotions.execute({
      sourceProcess: 'manual-sync',
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
}
