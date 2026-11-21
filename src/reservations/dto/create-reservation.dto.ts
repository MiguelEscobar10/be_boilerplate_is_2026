import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, IsUUID, Matches } from 'class-validator';
import { FECHA_HORA_CON_ZONA } from '@Availability/dto';

/**
 * Body de POST /reservas. No lleva importes: el costo y el depósito los
 * calcula el servidor a partir de la tarifa de la publicación.
 */
export class CreateReservationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Publicación que se quiere reservar.',
  })
  @IsDefined({ message: 'publicacionId es obligatorio.' })
  @IsUUID('all', { message: 'publicacionId debe ser un UUID.' })
  publicacionId!: string;

  @ApiProperty({
    description: 'Inicio del período, con zona horaria.',
    example: '2026-11-12T09:00:00-06:00',
  })
  @IsDefined({ message: 'inicio es obligatorio.' })
  @IsString({ message: 'inicio debe ser un texto.' })
  @Matches(FECHA_HORA_CON_ZONA, {
    message:
      'inicio debe ser una fecha y hora con zona, por ejemplo 2026-11-12T09:00:00-06:00.',
  })
  inicio!: string;

  @ApiProperty({
    description: 'Fin del período (no incluido), con zona horaria.',
    example: '2026-11-12T12:00:00-06:00',
  })
  @IsDefined({ message: 'fin es obligatorio.' })
  @IsString({ message: 'fin debe ser un texto.' })
  @Matches(FECHA_HORA_CON_ZONA, {
    message:
      'fin debe ser una fecha y hora con zona, por ejemplo 2026-11-12T12:00:00-06:00.',
  })
  fin!: string;
}
