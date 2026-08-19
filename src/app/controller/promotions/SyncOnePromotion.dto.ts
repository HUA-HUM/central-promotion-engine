import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SyncOnePromotionDto {
  @ApiProperty({
    description: 'Id de la promoción a sincronizar, tal como la devuelve Mercado Libre.',
    example: 'P-MLA17693022',
  })
  @IsString()
  promotionId!: string;

  @ApiPropertyOptional({
    description: 'Identificador de quién/qué disparó esta corrida, usado para logging de auditoría.',
    example: 'admin',
    default: 'manual',
  })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
