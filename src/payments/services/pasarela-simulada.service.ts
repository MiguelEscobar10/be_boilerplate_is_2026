import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as esperar } from 'node:timers/promises';

/** Configuración de la pasarela simulada. Las pruebas la reemplazan. */
export interface PasarelaConfig {
  /** Espera antes de responder, en milisegundos (2000 en la app). */
  retardoMs: number;
}

export const PASARELA_CONFIG = Symbol('PASARELA_CONFIG');

export const RETARDO_PASARELA_MS = 2000;

export const MOTIVO_RECHAZO_PASARELA =
  'Tarjeta rechazada por la pasarela de prueba';

export type ResultadoPasarela =
  { estado: 'APROBADO' } | { estado: 'RECHAZADO'; motivo: string };

/** Últimos 4 dígitos de las tarjetas de prueba y lo que decide cada una. */
const TARJETAS_DE_PRUEBA: Record<string, ResultadoPasarela> = {
  '4242': { estado: 'APROBADO' },
  '0002': { estado: 'RECHAZADO', motivo: MOTIVO_RECHAZO_PASARELA },
};

/**
 * Pasarela de pago simulada (H05). Decide solo por los últimos 4 dígitos:
 * 4242 aprueba y 0002 rechaza. Recibe solo esos 4 dígitos: nunca el número
 * completo ni el código de seguridad.
 */
@Injectable()
export class PasarelaSimuladaService {
  constructor(
    @Inject(PASARELA_CONFIG) private readonly config: PasarelaConfig,
  ) {}

  /** true si los 4 dígitos son de una tarjeta de prueba. */
  esTarjetaDePrueba(ultimos4: string): boolean {
    return Object.hasOwn(TARJETAS_DE_PRUEBA, ultimos4);
  }

  /** Espera el retardo configurado y devuelve la decisión. */
  async procesar(ultimos4: string): Promise<ResultadoPasarela> {
    const resultado = TARJETAS_DE_PRUEBA[ultimos4];
    if (!this.esTarjetaDePrueba(ultimos4) || !resultado) {
      throw new Error('La pasarela solo procesa tarjetas de prueba.');
    }
    if (this.config.retardoMs > 0) await esperar(this.config.retardoMs);
    return resultado;
  }
}
