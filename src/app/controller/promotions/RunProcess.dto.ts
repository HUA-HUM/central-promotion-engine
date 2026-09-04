import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RunProcessDto {
  @ApiPropertyOptional({
    description: 'Identificador de quién/qué disparó esta corrida, usado para logging de auditoría.',
    example: 'admin',
    default: 'manual',
  })
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
