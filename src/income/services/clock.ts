import { Injectable } from '@nestjs/common';

/**
 * Fuente de la hora actual. Es una clase abstracta para usarla como token de
 * inyección: la app usa `SystemClock` y las pruebas la reemplazan con
 * `overrideProvider(Clock).useValue({ now: () => fecha })`.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
