import { ApiProperty } from '@nestjs/swagger';

/** Respuesta del POST: el id de la calificación, como pide la ficha. */
export class TenantRatingCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}
