# Contrato del servicio de avisos

Contrato de `notificar(aviso)`, el servicio interno del Módulo 8 que registra
avisos en la bandeja de un usuario (historia H20, task BE-20.2). Es para los
módulos que emiten avisos: reservas (BE-03.1), confirmar/rechazar (BE-04.1),
pagos (BE-05.1), garantía (BE-09.2) y mensajería (BE-15.1).

Sale de la implementación de BE-20.1:
[`avisos.service.ts`](../../src/notifications/services/avisos.service.ts) y
[`aviso.types.ts`](../../src/notifications/types/aviso.types.ts). Los detalles
de implementación y las decisiones están en
[`docs/modulos/notificaciones.md`](../modulos/notificaciones.md).

**No es un endpoint.** No hay ruta HTTP para registrar avisos. Se llama desde
el código del backend, inyectando `AvisosService`.

## Cómo usarlo

Todo se importa desde un único lugar, `@Notifications`:

| Export | Qué es |
|---|---|
| `NotificationsModule` | Módulo de Nest que provee `AvisosService`. |
| `AvisosService` | El servicio, con `notificar(aviso)`. |
| `ModuloOrigen` | Enum de módulos de origen (valor y tipo). |
| `AvisoInvalidoError` | Error que lanza `notificar` si el aviso no cumple el contrato. |
| `Aviso`, `ReferenciaAviso`, `AvisoRegistrado`, `CampoAviso` | Tipos (solo `import type`). |

No importes desde `@Notifications/services`, `@Notifications/errors` ni otras
subcarpetas: son internas del módulo y pueden cambiar.

```ts
// reservas.module.ts
import { NotificationsModule } from '@Notifications';

@Module({ imports: [NotificationsModule] /* ... */ })
export class ReservasModule {}

// reservas.service.ts
import { AvisosService } from '@Notifications';

@Injectable()
export class ReservasService {
  constructor(private readonly avisos: AvisosService) {}
}
```

## Firma

```ts
notificar(aviso: Aviso): Promise<AvisoRegistrado>

interface Aviso {
  destinatarioId: string;
  titulo: string;
  mensaje: string;
  moduloOrigen: ModuloOrigen;
  referencia?: ReferenciaAviso | null;
}

interface ReferenciaAviso { tipo: string; id: string }
interface AvisoRegistrado { id: string }
```

Devuelve el `id` (UUID) del aviso. El aviso queda **no leído** y aparece en la
bandeja del destinatario (`GET /api/v1/notificaciones`).

## Campos

| Campo | Obligatorio | Regla |
|---|---|---|
| `destinatarioId` | sí | UUID de un usuario que exista. |
| `titulo` | sí | De 1 a 100 caracteres después de recortar. Un título de solo espacios es vacío. |
| `mensaje` | sí | De 1 a 500 caracteres después de recortar. Un mensaje de solo espacios es vacío. |
| `moduloOrigen` | sí | Un valor de `ModuloOrigen` (ver más abajo). |
| `referencia` | no | `{ tipo, id }`, los dos strings no vacíos después de recortar. `undefined` o `null` significa sin referencia. |

- **Recorte.** `titulo`, `mensaje`, `referencia.tipo` y `referencia.id` se
  recortan con `trim()`, que quita espacios, tabs y saltos de línea de los
  extremos. Los largos se miden sobre el texto recortado y así se guarda.
- **Caracteres, no bytes.** Un emoji o una letra con tilde cuentan como 1.
- **Referencia completa o ninguna.** Un `tipo` sin `id` (o al revés) es un
  error. Corresponde al par `reference_type` / `reference_id` de la tabla, que
  la base exige completo o vacío.

### Datos sensibles

`titulo` y `mensaje` **nunca** deben incluir números de tarjeta (ni los últimos
4 dígitos), códigos de seguridad, números de documentos (DUI, NIT, pasaporte) ni
contraseñas. Tampoco el texto de un mensaje del chat. **Los importes sí se
permiten**: H05 pide el monto total en el aviso de pago y H09 los montos
liberado y retenido de la garantía.

El servicio no lo verifica: lo garantiza quien llama.

## Errores

Si el aviso no cumple el contrato, `notificar` lanza `AvisoInvalidoError` y
**no registra nada**:

| Propiedad | Valor |
|---|---|
| `codigo` | Siempre `'AVISO_INVALIDO'`. |
| `campo` | El campo que falló (tipo `CampoAviso`). |
| `message` | Explicación en español. |

Se valida en este orden y se reporta solo el primer campo con error:

| `campo` | Cuándo |
|---|---|
| `destinatarioId` | Falta, no es string, no es UUID o el usuario no existe. |
| `titulo` | Falta, no es string, queda vacío al recortar o pasa de 100. |
| `mensaje` | Falta, no es string, queda vacío al recortar o pasa de 500. |
| `moduloOrigen` | Falta o no es un valor de `ModuloOrigen`. |
| `referencia` | Viene pero no es un objeto. |
| `referencia.tipo` | La referencia viene sin `tipo`. |
| `referencia.id` | La referencia viene sin `id`. |

`AvisoInvalidoError` no es una excepción HTTP: si se deja escapar desde un
controller, el cliente recibe un 500. Cualquier otro error (por ejemplo, la
base caída) se propaga tal cual, sin envolver. Ver
[Manejo de errores](#manejo-de-errores).

## Duplicados

Si ya existe un aviso con el **mismo destinatario, módulo de origen, referencia
y título**, `notificar` no crea otro y **devuelve el `id` del existente**, sin
error. Volver a avisar por el mismo evento (un reintento, un doble clic, dos
llamadas simultáneas) es seguro y no hace falta ningún manejo especial.

- El `mensaje` no es parte de la clave: el mismo aviso con otro texto es un
  duplicado y se conserva el texto original.
- **Sin referencia no se deduplica.** Dos avisos sin referencia son dos avisos.
- Un aviso ya leído sigue contando como existente: el duplicado no lo vuelve a
  marcar como no leído.

### Elegir la referencia

La referencia decide qué cuenta como "el mismo evento". Usa el id de la entidad
que **identifica el evento**, no la entidad más general:

| Evento | Referencia | Por qué |
|---|---|---|
| Solicitud nueva, reserva CONFIRMADA / RECHAZADA | `{ tipo: 'reserva', id: reserva.id }` | Pasa una vez por reserva. CONFIRMADA y RECHAZADA tienen títulos distintos, así que no chocan. |
| Pago APROBADO / RECHAZADO | `{ tipo: 'pago', id: pago.id }` | Una reserva admite hasta 3 intentos de pago. Con el id de la reserva, el segundo «Pago rechazado» se tomaría como duplicado y no llegaría. |
| Garantía resuelta | `{ tipo: 'reserva', id: reserva.id }` | Se resuelve una vez por reserva (hay a lo sumo una resolución por reserva) y su título es distinto de los de H03 y H04, así que no choca con ellos. |
| Mensaje nuevo | `{ tipo: 'mensaje', id: mensaje.id }` | Con el id de la conversación, solo habría un «Mensaje nuevo» por conversación para siempre. Con el del mensaje, cada mensaje avisa una vez. |

`tipo` en minúsculas y en singular, con el nombre de la entidad del brief
(`reserva`, `pago`, `mensaje`).

## Enum `ModuloOrigen`

Indica qué módulo generó el aviso. Usa el del módulo **que emite** el aviso,
aunque el aviso hable de otra entidad (por ejemplo, un pago de una reserva es
`PAGOS_GARANTIA`, no `RESERVAS`).

| Valor | Módulo | Cuándo usarlo |
|---|---|---|
| `CATALOGO` | Catálogo de equipos y espacios | Avisos sobre publicaciones de bienes. Sin eventos definidos hoy. |
| `BUSQUEDA` | Búsqueda | Sin eventos definidos hoy. |
| `RESERVAS` | Reservas | Solicitud nueva (H03) y reserva CONFIRMADA / RECHAZADA (H04). |
| `PAGOS_GARANTIA` | Pagos y garantía | Pago APROBADO / RECHAZADO (H05) y garantía resuelta (H09). |
| `MENSAJERIA` | Mensajería | Mensaje nuevo (H15, H16). |
| `RESENAS` | Reseñas | Avisos sobre reseñas. Sin eventos definidos hoy. |
| `VERIFICACION` | Verificación | Avisos sobre el resultado de una verificación. Sin eventos definidos hoy. |
| `NOTIFICACIONES` | Notificaciones | Avisos del propio Módulo 8. Sin eventos definidos hoy. |
| `REPORTES` | Reportes | Sin eventos definidos hoy. |

Siempre se usa la constante (`ModuloOrigen.RESERVAS`), no el string. Un valor
fuera del enum da `AvisoInvalidoError` con `campo: 'moduloOrigen'`. Agregar un
valor es una migración de DB (ver DB-20.1 en el documento del módulo).

## Eventos

La tabla de eventos del brief (H03, H04, H05, H09, H15, H16):

| Task emisora | Evento | Destinatario | Título | `moduloOrigen` |
|---|---|---|---|---|
| BE-03.1 | Solicitud nueva | Arrendador | Nueva solicitud de reserva | `RESERVAS` |
| BE-04.1 | Reserva CONFIRMADA o RECHAZADA | Arrendatario | Reserva CONFIRMADA / Reserva RECHAZADA | `RESERVAS` |
| BE-05.1 | Pago APROBADO | Arrendatario y arrendador | Pago aprobado / Pago confirmado | `PAGOS_GARANTIA` |
| BE-05.1 | Pago RECHAZADO | Arrendatario | Pago rechazado | `PAGOS_GARANTIA` |
| BE-09.2 | Garantía resuelta | Arrendatario | Depósito de garantía resuelto | `PAGOS_GARANTIA` |
| BE-15.1 | Mensaje nuevo | El otro participante | Mensaje nuevo | `MENSAJERIA` |

Los títulos son textos fijos: úsalos exactamente así. La bandeja y la
deduplicación dependen de ellos.

El texto exacto que emite hoy cada módulo (título, mensaje, destinatario y
referencia) está en el catálogo de BE-10.2, en
[`docs/modulos/notificaciones.md`](../modulos/notificaciones.md#be-102-catálogo-de-avisos-mp4-108).
Los ejemplos de abajo muestran la forma de la llamada; en BE-03.1 y BE-04.1 el
mensaje real además lleva la hora de la reserva, así que si hay diferencia vale
el catálogo.

## Ejemplos por módulo emisor

Los bloques de esta sección son copia exacta de
[`test/contratos/servicio-avisos.ejemplos.ts`](../../test/contratos/servicio-avisos.ejemplos.ts).
Ese archivo compila contra los tipos reales y lo ejecuta
[`servicio-avisos.contrato.spec.ts`](../../test/contratos/servicio-avisos.contrato.spec.ts)
(`npm test`), que también comprueba que este documento sigue igual al archivo.
Si cambias un ejemplo, cámbialo en los dos lugares.

Los parámetros (`reserva`, `pago`, ...) son formas mínimas para el ejemplo:
cada módulo usa sus propias entidades.

```ts
import {
  AvisoInvalidoError,
  AvisosService,
  ModuloOrigen,
  type Aviso,
  type AvisoRegistrado,
} from '@Notifications';
```

### BE-03.1 · Reservas: solicitud nueva

```ts
export function avisarSolicitudNueva(
  avisos: AvisosService,
  reserva: { id: string; arrendadorId: string; bienNombre: string },
): Promise<AvisoRegistrado> {
  return avisos.notificar({
    destinatarioId: reserva.arrendadorId,
    titulo: 'Nueva solicitud de reserva',
    mensaje: `Recibiste una solicitud de reserva para «${reserva.bienNombre}».`,
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reserva.id },
  });
}
```

### BE-04.1 · Confirmar o rechazar una reserva

El mensaje lleva el nombre del bien, las fechas de la reserva (dd/mm/aaaa, hora
de El Salvador) y el motivo si existe. Sin motivo, termina en «fue confirmada.»
o «fue rechazada.».

**Límite de 500 caracteres.** El motivo admite hasta 500 caracteres y el
`mensaje` del aviso también admite 500 en total, así que un motivo largo no
cabe completo. BE-04.1 debe recortar el motivo (como hace `agregarMotivo`) para
que el mensaje nunca pase de 500: si pasa, `notificar` lanza
`AvisoInvalidoError` y el aviso no se registra.

```ts
/** Largo máximo de `mensaje` en el contrato. */
const MENSAJE_MAX = 500;

const formatoFecha = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/El_Salvador',
});

/** dd/mm/aaaa en la hora de El Salvador. */
function formatearFecha(fecha: Date): string {
  const partes = Object.fromEntries(
    formatoFecha.formatToParts(fecha).map(({ type, value }) => [type, value]),
  );
  return `${partes.day}/${partes.month}/${partes.year}`;
}

/**
 * Agrega " Motivo: <motivo>." recortando el motivo para que el mensaje completo
 * no pase de MENSAJE_MAX. Cuenta caracteres igual que AvisosService.
 */
function agregarMotivo(base: string, motivo?: string): string {
  const texto = motivo?.trim();
  if (!texto) return base;
  const prefijo = ' Motivo: ';
  // Lo que queda para el motivo, descontando el punto final.
  const libre = MENSAJE_MAX - Array.from(base + prefijo).length - 1;
  const caracteres = Array.from(texto);
  if (caracteres.length <= libre) return `${base}${prefijo}${texto}.`;
  if (libre < 2) return base;
  const recortado = caracteres.slice(0, libre - 1).join('').trimEnd();
  return `${base}${prefijo}${recortado}….`;
}

export function avisarDecisionReserva(
  avisos: AvisosService,
  reserva: {
    id: string;
    arrendatarioId: string;
    bienNombre: string;
    fechaInicio: Date;
    fechaFin: Date;
    /** Opcional, hasta 500 caracteres. */
    motivo?: string;
  },
  estado: 'CONFIRMADA' | 'RECHAZADA',
): Promise<AvisoRegistrado> {
  const resultado = estado === 'CONFIRMADA' ? 'confirmada' : 'rechazada';
  const inicio = formatearFecha(reserva.fechaInicio);
  const fin = formatearFecha(reserva.fechaFin);
  const base = `Tu reserva de «${reserva.bienNombre}» del ${inicio} al ${fin} fue ${resultado}.`;
  return avisos.notificar({
    destinatarioId: reserva.arrendatarioId,
    titulo: `Reserva ${estado}`,
    mensaje: agregarMotivo(base, reserva.motivo),
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reserva.id },
  });
}
```

### BE-05.1 · Pagos: pago APROBADO o RECHAZADO

El mensaje lleva el nombre del bien y el monto total con dos decimales, sin
ningún dato de la tarjeta. Un pago aprobado genera dos avisos, uno por
destinatario. Si uno de los dos falla, se puede reintentar la función completa:
el que ya se registró se deduplica.

```ts
interface PagoParaAviso {
  /** Id del intento de pago (no de la reserva): ver "Elegir la referencia". */
  id: string;
  arrendatarioId: string;
  arrendadorId: string;
  bienNombre: string;
  /** Monto total de la reserva, en USD. */
  montoTotal: number;
}

/** Pago APROBADO: un aviso para el arrendatario y otro para el arrendador. */
export function avisarPagoAprobado(
  avisos: AvisosService,
  pago: PagoParaAviso,
): Promise<AvisoRegistrado[]> {
  const monto = `$${pago.montoTotal.toFixed(2)}`;
  const referencia = { tipo: 'pago', id: pago.id };
  return Promise.all([
    avisos.notificar({
      destinatarioId: pago.arrendatarioId,
      titulo: 'Pago aprobado',
      mensaje: `Tu pago de ${monto} por «${pago.bienNombre}» fue aprobado.`,
      moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
      referencia,
    }),
    avisos.notificar({
      destinatarioId: pago.arrendadorId,
      titulo: 'Pago confirmado',
      mensaje: `Se confirmó el pago de ${monto} de la reserva de «${pago.bienNombre}».`,
      moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
      referencia,
    }),
  ]);
}

/** Pago RECHAZADO: solo para el arrendatario. */
export function avisarPagoRechazado(
  avisos: AvisosService,
  pago: PagoParaAviso,
): Promise<AvisoRegistrado> {
  const monto = `$${pago.montoTotal.toFixed(2)}`;
  return avisos.notificar({
    destinatarioId: pago.arrendatarioId,
    titulo: 'Pago rechazado',
    mensaje: `Tu pago de ${monto} por «${pago.bienNombre}» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.`,
    moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
    referencia: { tipo: 'pago', id: pago.id },
  });
}
```

### BE-09.2 · Garantía resuelta

La referencia es la reserva (la garantía se resuelve una vez por reserva) y el
mensaje lleva los montos liberado y retenido con dos decimales, igual que
`deposit-resolutions.service.ts` (H09, ver
[`docs/modulos/devoluciones.md`](../modulos/devoluciones.md)).

```ts
export function avisarGarantiaResuelta(
  avisos: AvisosService,
  garantia: {
    /** Id de la reserva: la garantía se resuelve una vez por reserva. */
    reservaId: string;
    arrendatarioId: string;
    bienNombre: string;
    /** En USD. Liberado más retenido es el depósito de la reserva. */
    montoLiberado: number;
    montoRetenido: number;
  },
): Promise<AvisoRegistrado> {
  const liberado = `$${garantia.montoLiberado.toFixed(2)}`;
  const retenido = `$${garantia.montoRetenido.toFixed(2)}`;
  return avisos.notificar({
    destinatarioId: garantia.arrendatarioId,
    titulo: 'Depósito de garantía resuelto',
    mensaje: `El depósito de garantía de «${garantia.bienNombre}» fue resuelto: monto liberado ${liberado}, monto retenido ${retenido}.`,
    moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
    referencia: { tipo: 'reserva', id: garantia.reservaId },
  });
}
```

### BE-15.1 · Mensajería: mensaje nuevo

El destinatario es el **otro** participante de la conversación, nunca quien
envía el mensaje. El aviso lleva solo el nombre del bien, sin el texto del
mensaje, igual que `messaging.service.ts` (ver
[`docs/modulos/mensajeria.md`](../modulos/mensajeria.md)).

```ts
export function avisarMensajeNuevo(
  avisos: AvisosService,
  mensaje: {
    id: string;
    /** El otro participante de la conversación, no quien envía. */
    destinatarioId: string;
    bienNombre: string;
  },
): Promise<AvisoRegistrado> {
  return avisos.notificar({
    destinatarioId: mensaje.destinatarioId,
    titulo: 'Mensaje nuevo',
    // Sin el texto del mensaje: solo el nombre del bien.
    mensaje: `Tenés un mensaje nuevo sobre "${mensaje.bienNombre}".`,
    moduloOrigen: ModuloOrigen.MENSAJERIA,
    referencia: { tipo: 'mensaje', id: mensaje.id },
  });
}
```

## Manejo de errores

- **Llama después de confirmar la operación.** `AvisosService` usa su propia
  conexión, no la transacción de quien llama. Si avisas dentro de una
  transacción que después se revierte, el aviso queda apuntando a algo que no
  existe. Avisa cuando la reserva, el pago o el mensaje ya están guardados.
- **Un `AvisoInvalidoError` es un error de quien llama** (un campo mal armado),
  no del usuario. Cada módulo decide si hace fallar su operación. Si no quieres
  que un aviso fallido deshaga una operación ya hecha, repórtalo y sigue, como
  en el ejemplo. Cualquier otro error se propaga.
- **Reintentar es seguro** en los avisos con referencia, gracias a la
  deduplicación.

```ts
export async function notificarSinInterrumpir(
  avisos: AvisosService,
  aviso: Aviso,
  reportar: (detalle: string) => void,
): Promise<AvisoRegistrado | null> {
  try {
    return await avisos.notificar(aviso);
  } catch (error) {
    if (error instanceof AvisoInvalidoError) {
      reportar(`${error.codigo} en ${error.campo}: ${error.message}`);
      return null;
    }
    throw error;
  }
}
```
