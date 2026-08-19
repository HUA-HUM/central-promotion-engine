import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PromotionCatalogStatus, PromotionType } from '@core/entities/PromotionCatalog';

export class GetPromotionCatalogsDto {
  @ApiPropertyOptional({
    enum: PromotionCatalogStatus,
    description: 'Filtra por estado de sincronización del catálogo.',
    example: PromotionCatalogStatus.FINISHED,
  })
  @IsOptional()
  @IsEnum(PromotionCatalogStatus)
  status?: PromotionCatalogStatus;

  @ApiPropertyOptional({
    enum: PromotionType,
    description: 'Filtra por tipo de promoción.',
    example: PromotionType.DEAL,
  })
  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @ApiPropertyOptional({
    description: 'Filtra por promotionId exacto.',
    example: 'P-MLA16649022',
  })
  @IsOptional()
  @IsString()
  promotionId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por nombre de la promoción.',
    example: 'PREVIA MUNDIAL 2026',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Número de página, comienza en 1.',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items por página, hasta 200.',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
