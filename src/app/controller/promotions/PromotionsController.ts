import { BadRequestException, Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { ActivateDealPromotion } from '@core/interactors/promotion/ActivateDealPromotion';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { DeactivateDealPromotion } from '@core/interactors/promotion/DeactivateDealPromotion';
import { GetPromotions } from '@core/interactors/promotion/GetPromotions';
import { GetPromotionCatalogs } from '@core/interactors/promotion/GetPromotionCatalogs';
import { GetPromotionStats } from '@core/interactors/promotion/GetPromotionStats';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { SyncOnePromotion } from '@core/interactors/promotion/SyncOnePromotion';
import { GetPromotionsDto } from '@app/controller/promotions/GetPromotions.dto';
import { GetPromotionCatalogsDto } from '@app/controller/promotions/GetPromotionCatalogs.dto';
import { RunProcessDto } from '@app/controller/promotions/RunProcess.dto';
import { SyncOnePromotionDto } from '@app/controller/promotions/SyncOnePromotion.dto';
import { ActivateDealPromotionDto } from '@app/controller/promotions/ActivateDealPromotion.dto';
import { DeactivateDealPromotionDto } from '@app/controller/promotions/DeactivateDealPromotion.dto';
import { PromotionStatus } from '@core/entities/Promotion';

const PROMOTION_EXAMPLE = {
  _id: '6a8475d64b93c64b65ce4691',
  itemId: 'MLA3804909178',
  promotionId: 'P-MLA17693022',
  name: 'Ofertas Belleza Q3 2026',
  type: 'DEAL',
  status: 'SYNCED',
  startDate: '2026-06-20T03:00:00.000Z',
  finishDate: '2026-09-18T03:00:00.000Z',
  deadlineDate: '2026-09-18T03:00:00.000Z',
  sku: 'B0H83KL9HZ',
  categoryId: 'MLA393757',
  listingTypeId: 'gold_special',
  offerId: null,
  prices: {
    originalPrice: 412999,
    minPrice: 82599.81,
    maxPrice: 371699.1,
    suggestedPrice: 351049.16,
  },
  economics: {
    cost: 327100.41,
    profit: 44598.69,
    profitability: 12,
    margin: 13.63,
    profitable: true,
    shouldPause: false,
  },
  metadata: {
    syncedAt: '2026-08-18T15:10:14.464Z',
    updatedBy: 'admin',
    sourceProcess: 'manual-sync-one',
    statusReason: 'Promotion synchronized',
  },
  auditTrail: [
    {
      process: 'manual-sync-one',
      status: 'SYNCED',
      executedAt: '2026-08-18T15:10:14.464Z',
      reason: 'Promotion synchronized',
    },
  ],
  updatedAt: '2026-08-18T15:10:14.467Z',
};

const PROMOTION_CATALOG_EXAMPLE = {
  _id: '69e7a94795cb0611d17bc5da',
  promotionId: 'P-MLA16649022',
  name: 'PREVIA MUNDIAL 2026',
  type: 'DEAL',
  status: 'started',
  startDate: '2026-02-02T03:00:00.000Z',
  finishDate: '2026-05-01T03:00:00.000Z',
  deadlineDate: '2026-05-01T02:00:00.000Z',
  totalCandidates: 356834,
  createdAt: '2026-04-21T16:43:51.349Z',
  updatedAt: '2026-04-21T16:43:51.349Z',
};

const STATUS_BREAKDOWN_EXAMPLE = {
  total: 120,
  pending: 5,
  active: 80,
  paused: 10,
  synced: 20,
  deleted: 2,
  finished: 1,
  failedSync: 1,
  failedActivation: 1,
  failedDeactivation: 0,
};

@ApiTags('Promociones')
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
    @Inject('ActivateDealPromotion')
    private readonly activateDealPromotion: ActivateDealPromotion,
    @Inject('DeactivateDealPromotion')
    private readonly deactivateDealPromotion: DeactivateDealPromotion,
  ) {}

  @ApiOperation({ summary: 'Lista las promociones sincronizadas con filtros y paginación opcionales.' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de promociones.',
    schema: { example: { items: [PROMOTION_EXAMPLE], total: 42, page: 1, limit: 20, totalPages: 3 } },
  })
  @ApiResponse({ status: 400, description: 'Query params inválidos (ej. page < 1, limit > 200).' })
  @Get()
  async list(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters(query);
  }

  @ApiOperation({ summary: 'Lista los catálogos de promociones sincronizados (las promociones que expone Mercado Libre).' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de catálogos de promociones.',
    schema: { example: { items: [PROMOTION_CATALOG_EXAMPLE], total: 12, page: 1, limit: 20, totalPages: 1 } },
  })
  @ApiResponse({ status: 400, description: 'Query params inválidos (ej. status/type inexistente, page < 1, limit > 200).' })
  @Get('catalogs')
  async listCatalogs(@Query() query: GetPromotionCatalogsDto) {
    return this.getPromotionCatalogs.findWithFilters(query);
  }

  @ApiOperation({ summary: 'Devuelve un conteo de promociones agrupado por tipo y estado.' })
  @ApiResponse({
    status: 200,
    description: 'Desglose de estados por tipo de promoción.',
    schema: {
      example: {
        total: 320,
        smart: STATUS_BREAKDOWN_EXAMPLE,
        deal: STATUS_BREAKDOWN_EXAMPLE,
        preNegotiated: STATUS_BREAKDOWN_EXAMPLE,
      },
    },
  })
  @Get('stats')
  async stats() {
    return this.getPromotionStats.execute();
  }

  @ApiOperation({ summary: 'Lista las promociones actualmente activas en Mercado Libre, con filtros opcionales.' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de promociones activas.',
    schema: { example: { items: [{ ...PROMOTION_EXAMPLE, status: 'ACTIVE' }], total: 42, page: 1, limit: 20, totalPages: 3 } },
  })
  @ApiResponse({ status: 400, description: 'Query params inválidos (ej. page < 1, limit > 200).' })
  @Get('active')
  async listActive(@Query() query: GetPromotionsDto) {
    return this.getPromotions.findWithFilters({
      ...query,
      status: PromotionStatus.ACTIVE,
    });
  }

  @ApiOperation({ summary: 'Lista las promociones que fallaron en la sincronización, activación o desactivación.' })
  @ApiResponse({
    status: 200,
    description: 'Listado paginado de promociones fallidas.',
    schema: {
      example: {
        items: [{ ...PROMOTION_EXAMPLE, status: 'FAILED_ACTIVATION' }],
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Query params inválidos (ej. page < 1, limit > 200).' })
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

  @ApiOperation({ summary: 'No implementado: las promociones skipped no se persisten, por lo que no se pueden listar.' })
  @ApiResponse({
    status: 400,
    description: 'Siempre devuelve este código — el endpoint es un stub.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Skipped promotions are not persisted as a status yet, so they cannot be listed with pagination.',
      },
    },
  })
  @Get('skipped')
  async listSkipped() {
    throw new BadRequestException(
      'Skipped promotions are not persisted as a status yet, so they cannot be listed with pagination.',
    );
  }

  @ApiOperation({ summary: 'Dispara una sincronización completa de catálogos de promociones elegibles desde Mercado Libre.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen de la corrida de sincronización.',
    schema: { example: { process: 'manual-sync', total: 50, success: 45, failure: 3, skipped: 2 } },
  })
  @ApiResponse({ status: 500, description: 'Falla inesperada durante la sincronización (ej. error de una API externa).' })
  @Post('sync')
  async sync(@Body() body: RunProcessDto) {
    return this.syncAllPromotions.execute({
      sourceProcess: 'manual-sync',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Dispara la sincronización de un único catálogo de promoción por id.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen de la sincronización de esa promoción.',
    schema: { example: { process: 'sync-one', total: 5, success: 5, failure: 0, skipped: 0 } },
  })
  @ApiResponse({ status: 400, description: 'promotionId ausente o no es un string.' })
  @ApiResponse({
    status: 500,
    description: 'El promotionId no existe en Mercado Libre, o la sincronización falló inesperadamente.',
    schema: { example: { message: 'Promotion catalog P-MLA17693022 not found' } },
  })
  @Post('sync-one')
  async syncOne(@Body() body: SyncOnePromotionDto) {
    return this.syncOnePromotion.execute({
      promotionId: body.promotionId,
      sourceProcess: 'manual-sync-one',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Activa promociones SMART/PRE_NEGOTIATED pendientes que superan el umbral de rentabilidad. DEAL siempre se omite.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen de la corrida de activación.',
    schema: { example: { process: 'manual-activate', total: 20, success: 18, failure: 1, skipped: 1 } },
  })
  @ApiResponse({ status: 500, description: 'Falla inesperada durante la activación (ej. error de la API de Mercado Libre).' })
  @Post('activate')
  async activate(@Body() body: RunProcessDto) {
    return this.activatePromotions.execute({
      sourceProcess: 'manual-activate',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Desactiva promociones SMART/PRE_NEGOTIATED activas que ya no superan el umbral de rentabilidad. DEAL siempre se omite.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen de la corrida de desactivación.',
    schema: { example: { process: 'manual-deactivate', total: 15, success: 12, failure: 0, skipped: 3 } },
  })
  @ApiResponse({ status: 500, description: 'Falla inesperada durante la desactivación (ej. error de la API de Mercado Libre).' })
  @Post('deactivate')
  async deactivate(@Body() body: RunProcessDto) {
    return this.deactivatePromotions.execute({
      sourceProcess: 'manual-deactivate',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Reintenta la desactivación de promociones que quedaron en estado FAILED_DEACTIVATION.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen del reintento.',
    schema: { example: { process: 'manual-deactivate-failed', total: 4, success: 3, failure: 1, skipped: 0 } },
  })
  @ApiResponse({ status: 500, description: 'Falla inesperada durante el reintento (ej. error de la API de Mercado Libre).' })
  @Post('deactivate-failed')
  async deactivateFailed(@Body() body: RunProcessDto) {
    return this.deactivatePromotions.retryFailed({
      sourceProcess: 'manual-deactivate-failed',
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Activa manualmente uno o más items de una promoción DEAL; DEAL nunca se activa por cron.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen por resultado; el detalle por item queda solo en los logs estructurados.',
    schema: { example: { promotionId: 'P-MLA17693022', total: 10, success: 8, skipped: 1, failure: 1 } },
  })
  @ApiResponse({ status: 400, description: 'promotionId ausente, o mlas no es un array de strings.' })
  @ApiResponse({
    status: 500,
    description: 'La promoción no tiene items sincronizados, no es de tipo DEAL, o la activación falló inesperadamente.',
    schema: { example: { message: 'Promotion P-MLA17693022 is not a DEAL promotion' } },
  })
  @Post('deal/activate')
  async activateDeal(@Body() body: ActivateDealPromotionDto) {
    return this.activateDealPromotion.execute({
      promotionId: body.promotionId,
      mlas: body.mlas,
      updatedBy: body.updatedBy ?? 'manual',
    });
  }

  @ApiOperation({ summary: 'Desactiva manualmente uno o más items de una promoción DEAL y los libera nuevamente en Automeli.' })
  @ApiResponse({
    status: 201,
    description: 'Conteo resumen por resultado; el detalle por item queda solo en los logs estructurados.',
    schema: { example: { promotionId: 'P-MLA17693022', total: 10, success: 9, skipped: 0, failure: 1 } },
  })
  @ApiResponse({ status: 400, description: 'promotionId ausente, o mlas no es un array de strings.' })
  @ApiResponse({
    status: 500,
    description: 'La promoción no tiene items sincronizados, no es de tipo DEAL, o la desactivación falló inesperadamente.',
    schema: { example: { message: 'Promotion P-MLA17693022 has no synced items' } },
  })
  @Post('deal/deactivate')
  async deactivateDeal(@Body() body: DeactivateDealPromotionDto) {
    return this.deactivateDealPromotion.execute({
      promotionId: body.promotionId,
      mlas: body.mlas,
      updatedBy: body.updatedBy ?? 'manual',
    });
  }
}
