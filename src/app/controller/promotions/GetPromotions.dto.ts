import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PromotionStatus } from '@core/entities/Promotion';

export class GetPromotionsDto {
  @ApiPropertyOptional({
    enum: PromotionStatus,
    description: 'Filtra por un único estado de promoción.',
    example: PromotionStatus.ACTIVE,
  })
  @IsOptional()
  @IsString()
  status?: PromotionStatus;

  @ApiPropertyOptional({
    description: 'Filtra por seller id de Mercado Libre.',
    example: '123456789',
  })
  @IsOptional()
  @IsString()
  sellerId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por item id de Mercado Libre.',
    example: 'MLA3804909178',
  })
  @IsOptional()
  @IsString()
  itemId?: string;

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
