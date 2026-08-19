import { Body, Controller, Inject, Post } from '@nestjs/common';
import { AutomeliMlaControl } from '@core/interactors/promotion/AutomeliMlaControl';
import { AutomeliMlaControlDto } from '@app/controller/automeli/AutomeliMlaControl.dto';

@Controller('automeli')
export class AutomeliController {
  constructor(
    @Inject('AutomeliMlaControl')
    private readonly automeliMlaControl: AutomeliMlaControl,
  ) {}

  @Post('exclude')
  async exclude(@Body() body: AutomeliMlaControlDto) {
    return this.automeliMlaControl.exclude({ listingIds: body.listingIds });
  }

  @Post('include')
  async include(@Body() body: AutomeliMlaControlDto) {
    return this.automeliMlaControl.include({ listingIds: body.listingIds });
  }
}
