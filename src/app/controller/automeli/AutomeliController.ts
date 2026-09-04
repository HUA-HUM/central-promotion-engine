import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AutomeliMlaControl } from '@core/interactors/promotion/AutomeliMlaControl';
import { AutomeliMlaControlDto } from '@app/controller/automeli/AutomeliMlaControl.dto';

@ApiTags('Automeli')
@Controller('automeli')
export class AutomeliController {
  constructor(
    @Inject('AutomeliMlaControl')
    private readonly automeliMlaControl: AutomeliMlaControl,
  ) {}

  @ApiOperation({ summary: 'Excluye publicaciones de las actualizaciones de precio de Automeli, de forma manual e independiente de cualquier DEAL.' })
  @ApiResponse({
    status: 201,
    description: 'Resumen de matching/actualización de Automeli para las publicaciones solicitadas.',
    schema: {
      example: {
        status: 'success',
        requested: 2,
        updated: 2,
        matched: 2,
        notFound: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'listingIds ausente, vacío, o no es un array de strings.' })
  @ApiResponse({
    status: 500,
    description: 'Falla inesperada al llamar a la API de Automeli (ej. timeout, respuesta no 2xx).',
  })
  @Post('exclude')
  async exclude(@Body() body: AutomeliMlaControlDto) {
    return this.automeliMlaControl.exclude({ listingIds: body.listingIds });
  }

  @ApiOperation({ summary: 'Vuelve a incluir publicaciones en las actualizaciones de precio de Automeli, de forma manual e independiente de cualquier DEAL.' })
  @ApiResponse({
    status: 201,
    description: 'Resumen de matching/actualización de Automeli para las publicaciones solicitadas.',
    schema: {
      example: {
        status: 'success',
        requested: 2,
        updated: 2,
        matched: 2,
        notFound: [],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'listingIds ausente, vacío, o no es un array de strings.' })
  @ApiResponse({
    status: 500,
    description: 'Falla inesperada al llamar a la API de Automeli (ej. timeout, respuesta no 2xx).',
  })
  @Post('include')
  async include(@Body() body: AutomeliMlaControlDto) {
    return this.automeliMlaControl.include({ listingIds: body.listingIds });
  }
}
