import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class AutomeliMlaControlDto {
  @ApiProperty({
    type: [String],
    description: 'MLAs (item ids) a incluir o excluir de las actualizaciones de precio de Automeli.',
    example: ['MLA3804909178', 'MLA987654321'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  listingIds!: string[];
}
