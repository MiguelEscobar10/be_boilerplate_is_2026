import { ApiProperty } from '@nestjs/swagger';

export class IncomeItemDto {
  @ApiProperty({ format: 'uuid' })
  publicacionId!: string;

  @ApiProperty({ example: 'Taladro percutor' })
  nombre!: string;

  @ApiProperty({
    example: '130.00',
    description:
      'Suma del costo de alquiler de los pagos APROBADO del bien en el período, como texto con 2 decimales. Sin depósito.',
  })
  ingreso!: string;
}

export class IncomeReportDto {
  @ApiProperty({ example: '2026-11-01' })
  desde!: string;

  @ApiProperty({ example: '2026-11-30' })
  hasta!: string;

  @ApiProperty({ example: 'USD', enum: ['USD'] })
  moneda!: 'USD';

  @ApiProperty({
    example: '180.50',
    description: 'Suma de `ingreso` de los bienes, como texto con 2 decimales.',
  })
  total!: string;

  @ApiProperty({
    type: [IncomeItemDto],
    description:
      'Bienes activos del arrendador (también con 0.00) y los desactivados que tuvieron ingresos en el período.',
  })
  porBien!: IncomeItemDto[];
}
