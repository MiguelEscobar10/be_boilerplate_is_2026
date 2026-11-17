import {
  MOTIVO_RECHAZO_PASARELA,
  PasarelaSimuladaService,
} from './pasarela-simulada.service.js';

describe('PasarelaSimuladaService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('solo acepta las tarjetas de prueba 4242 y 0002', () => {
    const pasarela = new PasarelaSimuladaService({ retardoMs: 0 });
    expect(pasarela.esTarjetaDePrueba('4242')).toBe(true);
    expect(pasarela.esTarjetaDePrueba('0002')).toBe(true);
    for (const otra of ['0000', '4241', '1234', 'toString', '']) {
      expect(pasarela.esTarjetaDePrueba(otra)).toBe(false);
    }
  });

  it('4242 aprueba y 0002 rechaza con el motivo fijo', async () => {
    const pasarela = new PasarelaSimuladaService({ retardoMs: 0 });
    await expect(pasarela.procesar('4242')).resolves.toEqual({
      estado: 'APROBADO',
    });
    await expect(pasarela.procesar('0002')).resolves.toEqual({
      estado: 'RECHAZADO',
      motivo: MOTIVO_RECHAZO_PASARELA,
    });
  });

  it('espera el retardo configurado antes de responder', async () => {
    vi.useFakeTimers();
    const pasarela = new PasarelaSimuladaService({ retardoMs: 2000 });
    let listo = false;
    const promesa = pasarela.procesar('4242').then(() => {
      listo = true;
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(listo).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promesa;
    expect(listo).toBe(true);
  });

  it('no procesa una tarjeta que no es de prueba', async () => {
    const pasarela = new PasarelaSimuladaService({ retardoMs: 0 });
    await expect(pasarela.procesar('1111')).rejects.toThrow();
  });
});
