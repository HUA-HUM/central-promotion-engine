import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class ActivateDealPromotionDto {
  @ApiProperty({
    description: 'Id de la promoción DEAL, debe estar ya sincronizada en Mongo.',
    example: 'P-MLA17693022',
  })
  @IsString()
  promotionId!: string;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description:
      'MLAs a activar. Si se omite o se envía null, activa todos los items sincronizados de la promoción. Un array vacío no activa nada.',
    example: ['MLA3804909178', 'MLA987654321'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mlas?: string[] | null;

  @ApiPropertyOptional({
    description: 'Identificador de quién/qué disparó esta corrida, usado para logging de auditoría.',
    example: 'admin',
    default: 'manual',
  })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
