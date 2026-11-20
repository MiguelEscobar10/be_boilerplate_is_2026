import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Un bloqueo de fechas, como lo ve su dueño. */
export class BlockResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  publicacionId!: string;

  @ApiProperty({
    description: 'Inicio, en hora de El Salvador.',
    example: '2026-11-20T00:00:00-06:00',
  })
  inicio!: string;

  @ApiProperty({
    description: 'Fin (no incluido), en hora de El Salvador.',
    example: '2026-11-22T00:00:00-06:00',
  })
  fin!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Mantenimiento' })
  motivo!: string | null;
}

/** Bloqueos de una publicación (GET), para la tabla de FE-14.1. */
export class BlockListResponseDto {
  @ApiProperty({ type: [BlockResponseDto] })
  items!: BlockResponseDto[];
}
