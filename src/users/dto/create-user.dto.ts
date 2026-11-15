import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNormalizedEmail } from '@Common/decorators';

/** Roles que se pueden elegir al registrarse. REVISOR solo lo crea el seed. */
export const SELF_SERVICE_ROLES = ['ARRENDADOR', 'ARRENDATARIO'] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({
    description: 'Email del usuario. Se normaliza a minúsculas y sin espacios.',
    example: 'nestor@example.com',
    format: 'email',
    maxLength: 254,
  })
  @IsNormalizedEmail()
  email!: string;

  @ApiProperty({
    description:
      'Contraseña. Debe incluir al menos una minúscula, una mayúscula y un número.',
    example: 'Str0ngPass',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  // bcrypt trunca silenciosamente en 72 bytes, así que se rechaza antes de hashear.
  @MaxLength(72, {
    message: 'La contraseña no puede superar los 72 caracteres.',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'La contraseña debe incluir al menos una minúscula, una mayúscula y un número.',
  })
  password!: string;

  @ApiProperty({
    description: 'Rol de la cuenta. REVISOR no se puede registrar por la API.',
    enum: SELF_SERVICE_ROLES,
    example: 'ARRENDADOR',
  })
  @IsIn(SELF_SERVICE_ROLES, {
    message: 'ROL_NO_PERMITIDO: el rol debe ser ARRENDADOR o ARRENDATARIO.',
  })
  rol!: SelfServiceRole;

  @ApiProperty({ example: 'Lee Fuentes', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100, { message: 'El nombre no puede pasar de 100 caracteres.' })
  nombre!: string;

  @ApiProperty({ example: '70001234', description: 'Solo dígitos, de 8 a 15.' })
  @Transform(trim)
  @Matches(/^\d{8,15}$/, {
    message: 'El teléfono debe tener solo dígitos, entre 8 y 15.',
  })
  telefono!: string;
}
