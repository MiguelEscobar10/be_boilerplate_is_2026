import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CrearPagoSimuladoDto } from './crear-pago-simulado.dto.js';

/** Mismas opciones que main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const NUMERO = '4000056655665556';
const CVV = '7391';

async function validar(body: Record<string, unknown>) {
  return pipe
    .transform(body, { type: 'body', metatype: CrearPagoSimuladoDto })
    .then(() => null)
    .catch((e: unknown) => e as BadRequestException);
}

describe('CrearPagoSimuladoDto', () => {
  const valido = {
    numeroTarjeta: '4242424242424242',
    vencimiento: '12/28',
    cvv: '123',
  };

  it('acepta un request válido', async () => {
    expect(await validar(valido)).toBeNull();
  });

  it.each([
    ['13 dígitos', '4000000004242'],
    ['19 dígitos', '4000000000000004242'],
  ])('acepta números de %s', async (_c, numeroTarjeta) => {
    expect(await validar({ ...valido, numeroTarjeta })).toBeNull();
  });

  it('acepta una tarjeta vencida: la pasarela no revisa el vencimiento', async () => {
    expect(await validar({ ...valido, vencimiento: '01/20' })).toBeNull();
  });

  it.each([
    ['número de 12 dígitos', { numeroTarjeta: '424242424242' }],
    ['número de 20 dígitos', { numeroTarjeta: '42424242424242424242' }],
    ['número con espacios', { numeroTarjeta: '4242 4242 4242 4242' }],
    ['número con letras', { numeroTarjeta: '4242abcd42424242' }],
    ['número como number', { numeroTarjeta: 4242424242424242 }],
    ['vencimiento mes 00', { vencimiento: '00/28' }],
    ['vencimiento mes 13', { vencimiento: '13/28' }],
    ['vencimiento sin barra', { vencimiento: '1228' }],
    ['vencimiento con año de 4 dígitos', { vencimiento: '12/2028' }],
    ['cvv de 2 dígitos', { cvv: '12' }],
    ['cvv de 5 dígitos', { cvv: '12345' }],
    ['cvv con letras', { cvv: '12a' }],
    ['sin cvv', { cvv: undefined }],
    ['campo extra monto', { monto: '1.00' }],
    ['campo extra escenario', { escenario: 'APROBADO' }],
  ])('rechaza %s', async (_caso, cambios) => {
    const error = await validar({ ...valido, ...cambios });
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('los mensajes de error nunca repiten el número ni el cvv enviados', async () => {
    const error = await validar({
      numeroTarjeta: `${NUMERO}x`,
      vencimiento: '99/99',
      cvv: `${CVV}9`,
      extra: NUMERO,
    });
    const cuerpo = JSON.stringify(error?.getResponse());
    expect(cuerpo).not.toContain(NUMERO);
    expect(cuerpo).not.toContain(CVV);
  });
});
