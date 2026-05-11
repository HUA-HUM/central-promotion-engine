import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PromotionCatalogStatus, PromotionType } from '@core/entities/PromotionCatalog';

export class GetPromotionCatalogsDto {
  @IsOptional()
  @IsEnum(PromotionCatalogStatus)
  status?: PromotionCatalogStatus;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsString()
  promotionId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
