import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({
    example: '¿Incluye las brocas?',
    minLength: 1,
    maxLength: 1000,
  })
  // Se guarda sin los espacios de los extremos; un texto de solo espacios es vacío.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'El mensaje debe ser texto.' })
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío.' })
  @MaxLength(1000, { message: 'El mensaje no puede pasar de 1000 caracteres.' })
  contenido!: string;
}
