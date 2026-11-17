import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDefined } from 'class-validator';

/** Body de PATCH /publicaciones/{id}/requiere-verificacion. */
export class UpdateRequiresVerificationDto {
  @ApiProperty({ example: true })
  @IsDefined({ message: 'requiereVerificacion es obligatorio.' })
  @IsBoolean({ message: 'requiereVerificacion debe ser true o false.' })
  requiereVerificacion!: boolean;
}

export class RequiresVerificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: true })
  requiereVerificacion!: boolean;

  static fromEntity(listing: {
    id: string;
    requiresVerification: boolean;
  }): RequiresVerificationResponseDto {
    return {
      id: listing.id,
      requiereVerificacion: listing.requiresVerification,
    };
  }
}
