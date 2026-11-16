import { ApiProperty } from '@nestjs/swagger';

export class OccupancyItemDto {
  @ApiProperty({ format: 'uuid' })
  publicacionId!: string;

  @ApiProperty({ example: 'Taladro' })
  nombre!: string;

  @ApiProperty({
    example: 6,
    description:
      'Días distintos cubiertos por reservas CONFIRMADA, EN_CURSO o COMPLETADA (sin contar los bloqueados).',
  })
  diasOcupados!: number;

  @ApiProperty({
    example: 28,
    description: 'Días del período menos los días bloqueados.',
  })
  diasDisponibles!: number;

  @ApiProperty({
    example: 21.4,
    description:
      'diasOcupados / diasDisponibles × 100, con un decimal. 0 si no hay días disponibles.',
  })
  tasaOcupacion!: number;
}

export class OccupancyReportDto {
  @ApiProperty({ example: '2026-11-01' })
  desde!: string;

  @ApiProperty({ example: '2026-11-30' })
  hasta!: string;

  @ApiProperty({ type: [OccupancyItemDto] })
  items!: OccupancyItemDto[];
}
