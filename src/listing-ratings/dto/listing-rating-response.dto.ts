import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Respuesta del POST: el id de la calificación, como pide la ficha. */
export class ListingRatingCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

/** Promedios con un decimal; `null` si todavía no hay calificaciones. */
export class PromediosCalificacionDto {
  @ApiProperty({
    nullable: true,
    type: Number,
    example: 4.3,
    description: 'Promedio del bien (de esa publicación).',
  })
  promedioBien!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 4.7,
    description:
      'Promedio del arrendador (de todas las publicaciones que tiene).',
  })
  promedioArrendador!: number | null;
}

/** Calificación que el arrendatario ya dejó en una reserva. */
export class ListingRatingDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ example: 4 })
  puntajeBien!: number;

  @ApiProperty({ example: 5 })
  puntajeArrendador!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Todo en orden',
  })
  comentario!: string | null;

  @ApiProperty({ example: '2026-11-12T16:00:00.000Z' })
  fechaRegistro!: string;
}
