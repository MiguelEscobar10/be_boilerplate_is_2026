import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Datos de la tarjeta de prueba (H05). Sin monto ni escenario: el monto sale
 * de la reserva y el resultado lo decide la pasarela por los últimos 4
 * dígitos. Un campo extra da 400 (forbidNonWhitelisted).
 *
 * Los mensajes de validación son fijos y nunca incluyen el valor enviado
 * (`$value`), para que ni la respuesta ni los logs repitan la tarjeta.
 */
export class CrearPagoSimuladoDto {
  @ApiProperty({
    example: '4242424242424242',
    pattern: '^[0-9]{13,19}$',
    description:
      'De 13 a 19 dígitos, sin espacios. Terminada en 4242 aprueba y en 0002 rechaza; cualquier otra da 400 TARJETA_NO_VALIDA. Solo se guardan los últimos 4.',
  })
  @IsString({ message: 'El número de tarjeta debe ser texto.' })
  @Matches(/^[0-9]{13,19}$/, {
    message:
      'El número de tarjeta debe tener de 13 a 19 dígitos, sin espacios.',
  })
  numeroTarjeta!: string;

  @ApiProperty({
    example: '12/28',
    pattern: '^(0[1-9]|1[0-2])/[0-9]{2}$',
    description: 'MM/AA, con mes de 01 a 12. No se revisa si ya venció.',
  })
  @IsString({ message: 'El vencimiento debe ser texto.' })
  @Matches(/^(0[1-9]|1[0-2])\/[0-9]{2}$/, {
    message: 'El vencimiento debe tener el formato MM/AA, con mes de 01 a 12.',
  })
  vencimiento!: string;

  @ApiProperty({
    example: '123',
    pattern: '^[0-9]{3,4}$',
    description: '3 o 4 dígitos. No se guarda.',
  })
  @IsString({ message: 'El código de seguridad debe ser texto.' })
  @Matches(/^[0-9]{3,4}$/, {
    message: 'El código de seguridad debe tener 3 o 4 dígitos.',
  })
  cvv!: string;
}
