# Módulo 4: Pagos simulados y garantía

Pago simulado de una reserva confirmada (historia H05) y su comprobante para
el arrendatario (H06). No se conecta con ninguna pasarela real: BE-05.1 decide
el resultado según la tarjeta de prueba y aquí queda el registro de cada
intento.

## DB-05.1. Registro de intentos de pago simulado (MP4-64)

### Modelo de datos

Migración
[`20261116054019_create_simulated_payments`](../../prisma/migrations/20261116054019_create_simulated_payments/migration.sql).

**Tabla `simulated_payments`** (modelo Prisma `SimulatedPayment`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `reservation_id` | `UUID` | no | Reserva que se paga. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `total_amount` | `DECIMAL(12,2)` | no | Total cobrado. `CHECK (>= 0)` y `CHECK (total_amount = rental_cost + deposit_amount)`. |
| `rental_cost` | `DECIMAL(12,2)` | no | Costo del alquiler. `CHECK (>= 0)`. |
| `deposit_amount` | `DECIMAL(12,2)` | no | Depósito de garantía. `CHECK (>= 0)`. |
| `status` | `SimulatedPaymentStatus` | no | Resultado del intento. `PENDIENTE` por defecto. |
| `card_last4` | `CHAR(4)` | no | Últimos 4 dígitos de la tarjeta. `CHECK (card_last4 ~ '^[0-9]{4}$')`. |
| `rejection_reason` | `VARCHAR(200)` | sí | Motivo del rechazo. Obligatorio si `RECHAZADO`, con al menos un carácter que no sea espacio en blanco; `NULL` en los demás estados. |
| `attempt_number` | `INTEGER` | no | Número de intento dentro de la reserva. `CHECK (BETWEEN 1 AND 3)`. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha del intento, en UTC. |

**Enum `SimulatedPaymentStatus`**: `PENDIENTE`, `APROBADO`, `RECHAZADO`. Los
valores se quedan en español porque son los mismos que viajan en la API
(`estado`).

**No hay columnas para el número completo de la tarjeta ni para el código de
seguridad.** Solo se guardan los últimos 4 dígitos. BE-05.1 recibe la tarjeta,
decide el resultado y la descarta.

La tabla `reservations` no cambia: la relación inversa
(`Reservation.simulatedPayments`) existe solo en el cliente de Prisma.

### Restricciones e índices

| Nombre | Tipo | Regla |
|---|---|---|
| `simulated_payments_reservation_id_fkey` | FK | El pago pertenece a una reserva existente. `ON DELETE RESTRICT`. |
| `simulated_payments_total_amount_check` | CHECK | `total_amount >= 0` |
| `simulated_payments_rental_cost_check` | CHECK | `rental_cost >= 0` |
| `simulated_payments_deposit_amount_check` | CHECK | `deposit_amount >= 0` |
| `simulated_payments_total_matches_parts_check` | CHECK | `total_amount = rental_cost + deposit_amount` |
| `simulated_payments_attempt_number_check` | CHECK | `attempt_number BETWEEN 1 AND 3` |
| `simulated_payments_card_last4_check` | CHECK | `card_last4 ~ '^[0-9]{4}$'` |
| `simulated_payments_rejection_reason_check` | CHECK | `RECHAZADO` con `rejection_reason IS NOT NULL AND rejection_reason ~ '\S'`; los demás estados con `NULL`. |
| `simulated_payments_reservation_id_attempt_number_key` | UNIQUE | Un número de intento no se repite dentro de una reserva. |
| `simulated_payments_one_approved_per_reservation_key` | UNIQUE parcial | `(reservation_id) WHERE status = 'APROBADO'`: un solo pago aprobado por reserva. |
| `simulated_payments_reservation_id_created_at_id_idx` | Índice | `(reservation_id, created_at DESC, id DESC)`: historial de intentos, el más reciente primero. |
| `simulated_payments_status_created_at_idx` | Índice | `(status, created_at)`: pagos por estado y rango de fechas, para consultas que no pasen por un arrendador. La consulta de ingresos por bien no lo usa. Lo agrega [DB-21.1](#db-211-consulta-de-ingresos-por-bien-mp4-115). |

Los `CHECK` y el único parcial van escritos a mano al final del
`migration.sql`, porque Prisma no los modela. Los demás los genera Prisma
desde el schema.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `pago_simulado` (tabla) | `simulated_payments` | `SimulatedPayment` |
| `id` | `id` | `id` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `monto_total` | `total_amount` | `totalAmount` |
| `costo_alquiler` | `rental_cost` | `rentalCost` |
| `deposito_monto` | `deposit_amount` | `depositAmount` |
| `estado` | `status` | `status` |
| `tarjeta_ultimos4` | `card_last4` | `cardLast4` |
| `motivo_rechazo` | `rejection_reason` | `rejectionReason` |
| `numero_intento` | `attempt_number` | `attemptNumber` |
| `created_at` | `created_at` | `createdAt` |

### Decisiones

- **Cada intento es una fila nueva.** Un rechazo no sobrescribe el intento
  anterior: el siguiente intento inserta otra fila con el número siguiente.
  Por eso no hay `updated_at`.
- **Como máximo tres intentos por reserva.** El `CHECK` de 1 a 3 y el único
  `(reservation_id, attempt_number)` juntos dejan a lo sumo tres filas por
  reserva, aunque lleguen dos peticiones a la vez con el mismo número.
- **Un solo `APROBADO` por reserva.** Lo garantiza el índice único parcial:
  los `RECHAZADO` y `PENDIENTE` pueden ser varios, pero un segundo `APROBADO`
  falla con violación de unicidad (P2002 en Prisma).
- **El total se comprueba contra sus partes.** `total_amount = rental_cost +
  deposit_amount` evita un recibo incoherente. Que esos importes coincidan con
  la fotografía de precio de la reserva lo valida BE-05.1, porque en la base
  haría falta un trigger.
- **El motivo depende del estado.** Es obligatorio en un `RECHAZADO`, para
  que el arrendatario sepa por qué falló, y `NULL` en los demás estados. Debe
  tener al menos un carácter que no sea espacio en blanco (`~ '\S'`): así
  se rechazan también los motivos de solo saltos de línea o tabs, que
  `btrim` no quitaba. El `IS NOT NULL` sigue haciendo falta, porque con `NULL`
  la expresión regular da `NULL` y el `CHECK` lo dejaría pasar.
- **Sin número de transacción.** La tabla no tiene `numero_transaccion`: no
  aparece en las historias H05 y H06 ni en BE-05.1 y BE-06.1, solo en la
  ficha de Jira de DB-05.1, que está desactualizada.
- **`card_last4` es obligatorio.** BE-05.1 solo guarda intentos con las
  tarjetas de prueba (terminadas en `4242` o `0002`); cualquier otra devuelve
  400 sin crear fila, así que todo intento guardado tiene tarjeta. `CHAR(4)`
  rellena con espacios un valor de 3 dígitos y el `CHECK` lo rechaza.
- **`RESTRICT` hacia la reserva.** El pago es un registro financiero y el
  recibo no debe desaparecer si se borra la reserva. Es la misma regla que
  usan las reservas hacia la publicación y el arrendatario.
- **Sin triggers.** Todo lo que se valida en la base es declarativo (`CHECK`,
  `UNIQUE`, FK). Las reglas que dependen de otras tablas quedan en el servicio.

### Qué queda para otras tasks

- **BE-05.1:** validar la tarjeta de prueba, copiar los importes de la
  reserva y calcular el `attempt_number` siguiente. Hecho: ver
  [BE-05.1](#be-051-simulación-y-persistencia-del-pago-mp4-65).

### Prueba de restricciones

[`test/payments.constraints.e2e-spec.ts`](../../test/payments.constraints.e2e-spec.ts)
comprueba cada restricción de la tabla: la FK, los importes negativos y en
cero, el total incoherente, los intentos 0 y 4 (y 1 a 3 válidos), el intento
repetido, el segundo `APROBADO` por reserva, que varios `RECHAZADO` convivan
con el `APROBADO` final, la tarjeta con letras, espacios, 3 y 5 dígitos, el
motivo según el estado (vacío o formado solo por espacios, saltos de línea o
tabs se rechaza; con texto rodeado de espacios en blanco se acepta), el motivo
de más de 200 caracteres, la existencia de los índices y el `RESTRICT` al borrar la reserva. Al
terminar borra los pagos, reservas, publicación y usuarios que creó.

Corre contra la misma base de pruebas que las demás:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```

## BE-05.1. Simulación y persistencia del pago (MP4-65)

Endpoint para que el arrendatario pague una reserva CONFIRMADA con una
tarjeta de prueba (historia H05). Módulo nuevo `PaymentsModule`, alias
`@Payments`.

```
src/payments/
  payments.module.ts                       importa NotificationsModule
  controllers/pagos.controller.ts          POST reservas/:id/pagos/simulados
  services/pagos.service.ts                reglas, intentos y avisos
  services/pasarela-simulada.service.ts    decide por los últimos 4 y espera 2 s
  repositories/pago.repository.ts          transacción con FOR UPDATE, simulated_payments
  dto/                                     request, respuesta y forma del error con codigo
  errors/pago.errors.ts                    excepciones con codigo
```

### Endpoint

`POST /api/v1/reservas/{id}/pagos/simulados`. Solo rol `ARRENDATARIO`, y solo
el arrendatario de la reserva. Está en Swagger (`/api/docs`, etiqueta `pagos`)
con `ApiBearerAuth` y todos los códigos de abajo.

```json
{ "numeroTarjeta": "4242424242424242", "vencimiento": "12/28", "cvv": "123" }
```

| Campo | Regla |
|---|---|
| `numeroTarjeta` | De 13 a 19 dígitos, sin espacios. Sin Luhn: deciden los últimos 4. |
| `vencimiento` | `MM/AA`, con mes de `01` a `12`. **No se rechazan tarjetas vencidas**: la pasarela decide solo por los últimos 4 dígitos y esa regla no está en la ficha. |
| `cvv` | 3 o 4 dígitos. No se guarda. |

No lleva monto ni escenario. Cualquier campo extra (`monto`, `escenario`, ...)
da 400 por `forbidNonWhitelisted`.

**Pasarela simulada.** Espera 2 segundos y decide por los últimos 4 dígitos:

| Últimos 4 | Resultado |
|---|---|
| `4242` | `APROBADO` |
| `0002` | `RECHAZADO`, motivo «Tarjeta rechazada por la pasarela de prueba» |
| otro | 400 `TARJETA_NO_VALIDA`, sin crear ninguna fila |

**201:**

```json
{
  "pagoId": "8c0d9a3e-1f2b-4c5d-9e8f-7a6b5c4d3e2f",
  "reservaId": "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
  "montoTotal": "50.05",
  "estado": "RECHAZADO",
  "simulado": true,
  "intento": 1,
  "motivo": "Tarjeta rechazada por la pasarela de prueba"
}
```

`motivo` solo viene si es `RECHAZADO`. En ese caso el cobro queda pendiente:
la reserva sigue `CONFIRMADA` y se puede reintentar, sin ningún campo extra en
la respuesta. `montoTotal` es un string con 2 decimales, como los importes de
`listings`.

### Errores

| Código | `codigo` | Cuándo |
|---|---|---|
| 400 | — | Formato del número, vencimiento o cvv; campo extra; `{id}` que no es UUID. Formato por defecto de class-validator. |
| 400 | `TARJETA_NO_VALIDA` | La tarjeta no termina en `4242` ni en `0002`. |
| 401 | — | Sin token, token inválido o cuenta inactiva. |
| 403 | — | El rol no es `ARRENDATARIO`. |
| 404 | — | La reserva no existe o es de otro arrendatario. Mismo mensaje en los dos casos. |
| 409 | `PAGO_YA_APROBADO` | La reserva ya tiene un pago aprobado. |
| 409 | `RESERVA_NO_CONFIRMADA` | La reserva no está `CONFIRMADA`. |
| 409 | `PAGO_EN_PROCESO` | Otro intento de la misma reserva está esperando la pasarela (doble envío). |
| 409 | `INTENTOS_AGOTADOS` | Ya hay 3 intentos. |

Se revisan en este orden: primero los 400 (validación del DTO y luego
`TARJETA_NO_VALIDA`, antes de tocar la base), después el 404 y por último los
409 en el orden de la tabla. `PAGO_YA_APROBADO` va antes que
`RESERVA_NO_CONFIRMADA`: si la reserva ya se pagó y luego cambió de estado, la
respuesta dice que ya está pagada.

**Campo `codigo` sin filtro global.** El backend usa el formato de error por
defecto de Nest y no tiene un filtro de excepciones. Para no crear uno, los
errores con nombre se lanzan con un objeto como cuerpo
(`new ConflictException({ statusCode, message, error, codigo })`), que Nest
devuelve tal cual. La respuesta es el formato de siempre más `codigo`:

```json
{
  "statusCode": 409,
  "message": "Ya se usaron los 3 intentos de pago de esta reserva.",
  "error": "Conflict",
  "codigo": "INTENTOS_AGOTADOS"
}
```

Los 400 de validación, 401, 403 y 404 quedan en el formato por defecto, sin
`codigo`. Las fábricas están en
[`src/payments/errors/pago.errors.ts`](../../src/payments/errors/pago.errors.ts).

### Reglas

- **El monto sale de la reserva.** `montoTotal = rental_cost + deposit_amount`
  de la reserva en la base, sumados con `Prisma.Decimal` (sin floats). El
  intento guarda los dos importes y el total, y el CHECK de DB-05.1 comprueba
  que cuadren.
- **Como máximo 3 intentos.** Cada intento es una fila nueva con
  `attempt_number` 1, 2 o 3. El cuarto da 409 `INTENTOS_AGOTADOS`.
- **El pago no cambia el estado de la reserva.** Después de un rechazo, incluso
  del tercero, la reserva sigue `CONFIRMADA`. No hay cancelación automática.
  La ficha de Jira traía un párrafo que decía lo contrario; manda el documento
  corregido.
- **Tarjeta.** Solo se guardan los últimos 4 dígitos (`card_last4`). El
  controller pasa al servicio solo esos 4 dígitos: el número completo y el
  cvv no llegan al servicio, a la base, a los avisos ni a los logs. Los
  mensajes de validación son fijos y no incluyen el valor enviado.
- **Motivo con `trim()`.** El motivo de rechazo se guarda recortado: la base
  exige al menos un carácter que no sea espacio.
- **Avisos.** Se importan desde `@Notifications` y usan los textos del
  [contrato](../contratos/servicio-avisos.md):
  - `APROBADO` avisa al arrendatario («Pago aprobado») y al arrendador («Pago
    confirmado»). `RECHAZADO` avisa solo al arrendatario («Pago rechazado»).
  - `moduloOrigen` es `PAGOS_GARANTIA` y la referencia, `{ tipo: 'pago', id:
    pago.id }`.
  - El mensaje lleva el nombre del bien y el monto, sin datos de la tarjeta.
  - Si un aviso falla, el pago ya quedó guardado: se registra el error en el
    log y la respuesta no cambia.

### Concurrencia y la espera de 2 segundos

El pago tiene tres fases, para no mantener bloqueada la reserva durante la
espera de la pasarela:

1. **Transacción corta con bloqueo.** `SELECT id FROM reservations WHERE id = $1
   FOR UPDATE`. Con la fila bloqueada, valida la reserva y los intentos
   previos (el 404 y los 409 de arriba) y registra el intento como
   `PENDIENTE`, con los importes y `card_last4`. El commit libera el bloqueo.
2. **Pasarela, sin bloqueo.** Espera 2 segundos y decide.
3. **Resultado.** `UPDATE ... WHERE id = ? AND status = 'PENDIENTE'` a
   `APROBADO` o `RECHAZADO`, y después los avisos.

**Doble envío.** Si llegan dos peticiones a la vez para la misma reserva, la
segunda espera el bloqueo y, al obtenerlo, ve el `PENDIENTE` de la primera.
Responde 409 `PAGO_EN_PROCESO`, sin crear fila ni gastar intento.

- Da igual que la tarjeta apruebe o rechace: solo se procesa una.
- Si las dos iban a terminar en rechazo, el usuario reintenta después y ese
  reintento es el intento 2.
- Además, el índice único parcial de DB-05.1 impide dos `APROBADO` por reserva,
  y el único `(reservation_id, attempt_number)` impide repetir un número de
  intento.

**Intento huérfano.** Si el proceso se cae entre las fases 1 y 3, el intento
quedaría `PENDIENTE` para siempre y bloquearía la reserva. Por eso, en la
fase 1, un `PENDIENTE` de más de 30 segundos (constante
`PENDIENTE_HUERFANO_MS`) se cierra como `RECHAZADO` con el motivo «El intento
de pago no se completó».

- **Cuenta como intento.** La pasarela tarda 2 s, así que el margen es amplio.
- El cierre se guarda aunque la petición termine en 409 (por ejemplo
  `INTENTOS_AGOTADOS`), porque la transacción devuelve el error en vez de
  lanzarlo dentro.
- Si un intento se cerró como huérfano mientras su pasarela todavía
  respondía, la fase 3 no lo toca. La respuesta informa lo que quedó guardado,
  sin avisos.

### Decisiones

- **El servicio pone el `created_at` del intento.** Usa el mismo reloj con el
  que detecta huérfanos, en vez del `DEFAULT CURRENT_TIMESTAMP` de la base.
  Así la comparación no depende de la zona horaria de la sesión de Postgres.
- **La espera es inyectable.** `PASARELA_CONFIG` (`{ retardoMs: 2000 }`) es un
  provider del módulo; las pruebas lo reemplazan para no esperar.
- **`TARJETA_NO_VALIDA` va antes que el 404 y los 409.** Es un error de los
  datos enviados y se detecta sin tocar la base. No revela nada de la reserva.
- **Sin Luhn ni vencimiento.** La ficha solo pide que decidan los últimos 4
  dígitos: un número que no cumple Luhn o una tarjeta vencida no son errores
  de la pasarela de prueba.

### Pruebas

- **Unitarias** (`npm test`):
  - [`pagos.service.spec.ts`](../../src/payments/services/pagos.service.spec.ts):
    - Aprobado y rechazado, con los importes en `Decimal`.
    - 400 `TARJETA_NO_VALIDA` sin tocar la base.
    - 404 (inexistente y ajena), cada 409 y su prioridad.
    - Huérfano cerrado y que cuenta como intento.
    - Contenido de los avisos y aviso que falla.
  - [`pasarela-simulada.service.spec.ts`](../../src/payments/services/pasarela-simulada.service.spec.ts):
    la decisión por los 4 dígitos y la espera, con timers falsos.
  - [`crear-pago-simulado.dto.spec.ts`](../../src/payments/dto/crear-pago-simulado.dto.spec.ts):
    formatos válidos e inválidos, campos extra, tarjeta vencida aceptada y
    mensajes sin el valor enviado.
- **E2e**
  ([`test/payments.pagos-simulados.e2e-spec.ts`](../../test/payments.pagos-simulados.e2e-spec.ts)):
  - **Montaje:** la app completa contra la base `_test`, con la espera en 0 ms
    (300 ms en la prueba de concurrencia).
  - **Datos:** las reservas se crean directo en la base con estado
    `CONFIRMADA`, porque BE-04.1 todavía no está en `main`.
  - **Casos:**
    - 4242 aprobado y 0002 rechazado, persistidos con intento 1 a 3; el cuarto
      da 409 `INTENTOS_AGOTADOS` y la reserva sigue `CONFIRMADA` tras los
      rechazos.
    - Monto tomado de la reserva (0.10 + 0.20 = `0.30`).
    - 400 por otra tarjeta, datos inválidos y campos extra.
    - 409 por reserva `PENDIENTE` o `RECHAZADA`, y `PAGO_YA_APROBADO`.
    - 404 por reserva ajena e inexistente; 403 para `ARRENDADOR`; 401 sin
      token.
    - Dos peticiones simultáneas (con 4242 y con 0002): una da 201, la otra 409
      `PAGO_EN_PROCESO`, y queda un solo intento guardado.
    - Intento huérfano cerrado, y uno reciente que no se cierra.
    - Avisos guardados con el contenido definido, y un aviso que falla sin
      cambiar la respuesta.
    - Con un logger que captura todo lo que escribe la app: ni los logs, ni
      las respuestas, ni la base (`simulated_payments` y `notifications`)
      contienen el número completo ni el cvv.

```bash
# 1. Migraciones en la base de pruebas (URL que ya termina en _test)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" npx prisma migrate deploy

# 2. Las pruebas, con la DATABASE_URL normal del .env (el helper usa ..._test)
#    o con TEST_DATABASE_URL apuntando directo a la base _test
npx vitest run --config ./vitest.config.e2e.ts test/payments.pagos-simulados.e2e-spec.ts --reporter=verbose
```

En el paso 2, no dejes `DATABASE_URL` apuntando a la base `_test`: el helper
le agregaría otro `_test`.

## DB-06.1. Consulta del último pago por reserva (MP4-68)

Consulta que usará BE-06.1 para devolver el estado del pago (historia H06).
**No agrega migración, tablas, columnas ni índices**: el índice que pide la
task ya lo creó DB-05.1 y aquí solo se verifica y se documenta su reutilización.

### Consulta

```sql
SELECT * FROM simulated_payments
WHERE reservation_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 1;
```

En Prisma:

```ts
prisma.simulatedPayment.findFirst({
  where: { reservationId },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
});
```

- Con varios intentos devuelve el más reciente.
- Con cero intentos no devuelve ninguna fila (`null`).
- Si dos intentos tuvieran el mismo `created_at`, `id DESC` desempata, así que
  el resultado es siempre el mismo.

### Índice

Reutiliza `simulated_payments_reservation_id_created_at_id_idx`
`(reservation_id, created_at DESC, id DESC)` de DB-05.1. El orden del índice
coincide con el `ORDER BY`, así que Postgres lee una sola entrada, sin `Sort`.
No se crea otro índice igual.

### Prueba

[`test/payments.latest-payment.e2e-spec.ts`](../../test/payments.latest-payment.e2e-spec.ts)
comprueba: varios intentos, cero intentos, que no se mezclen pagos de otra
reserva, el desempate por `id`, que exista un solo índice con esas columnas y
que `EXPLAIN` lo use sin `Sort`. Para el `EXPLAIN` desactiva el recorrido
secuencial dentro de una transacción (`SET LOCAL enable_seqscan = off`), porque
con pocas filas el planificador lo prefiere.

## DB-21.1. Consulta de ingresos por bien (MP4-115)

Consulta que usará BE-21.1 para el reporte de ingresos del arrendador
(historia H21). No agrega tablas ni columnas: solo un índice y una función
SQL sobre `simulated_payments`, `reservations` y `listings`.

### Modelo de datos

Migración
[`20261116180000_add_listing_income_query`](../../prisma/migrations/20261116180000_add_listing_income_query/migration.sql).

| Nombre | Tipo | Detalle |
|---|---|---|
| `simulated_payments_status_created_at_idx` | Índice | `simulated_payments (status, created_at)`. `listing_income` no lo usa (ver abajo); queda disponible para consultas de pagos por estado y rango de fechas que no pasen por un arrendador. Lo genera Prisma desde `@@index([status, createdAt])`. |
| `listing_income(p_landlord_id uuid, p_from timestamp, p_to timestamp)` | Función SQL (`LANGUAGE sql STABLE`) | Ingresos por bien del arrendador en el rango. Escrita a mano al final del `migration.sql`, porque Prisma no modela funciones. |

**Parámetros**

| Parámetro | Tipo | Significado |
|---|---|---|
| `p_landlord_id` | `uuid` | Arrendador dueño de los bienes. |
| `p_from` | `timestamp` (UTC) | Inicio del rango, **incluido**. |
| `p_to` | `timestamp` (UTC) | Fin del rango, **excluido**. |

**Resultado**: una fila por cada publicación del arrendador, ordenadas por
`listing_name` y luego por `listing_id`.

| Columna | Tipo | Significado |
|---|---|---|
| `listing_id` | `uuid` | Publicación. |
| `listing_name` | `varchar(100)` | Nombre de la publicación. |
| `is_active` | `boolean` | Si la publicación está activa. |
| `income` | `numeric`, siempre con 2 decimales | Suma de `simulated_payments.rental_cost` de los pagos `APROBADO` de las reservas del bien con `created_at` en `[p_from, p_to)`. `0.00` si no hay ninguno. |

El total del arrendador es la suma de `income` de todas las filas; lo calcula
BE-21.1.

### Cómo llamarla desde Prisma

Con `$queryRaw` (parámetros enlazados, sin concatenar texto), con las fechas
como `Date` de JS y los tres parámetros casteados:

```ts
type IngresoPorBienRow = {
  listing_id: string;
  listing_name: string;
  is_active: boolean;
  income: Prisma.Decimal;
};

const filas = await prisma.$queryRaw<IngresoPorBienRow[]>`
  SELECT listing_id, listing_name, is_active, income
  FROM listing_income(${id}::uuid, ${desde}::timestamp, ${hasta}::timestamp)`;

filas[0].income.toFixed(2); // "130.00"
```

`income` llega como `Prisma.Decimal`: hay que sumarlo y formatearlo con
`Decimal`, sin pasarlo a `number`. La prueba de abajo comprueba que, con
fechas `Date`, el resultado no cambia con la zona horaria del proceso de Node
ni con la de la sesión de Postgres.

### Decisiones

- **Suma `simulated_payments.rental_cost`, no `reservations.rental_cost`.**
  Es el costo que realmente se cobró, copiado en el pago (BE-05.1). Si el
  precio de la reserva cambiara después, el ingreso histórico no se movería.
  Además, el CHECK `total_amount = rental_cost + deposit_amount` garantiza que
  esa columna es solo alquiler. La tabla `reservations` solo hace falta para
  llegar al `listing_id`.
- **El depósito no entra.** No se suma `deposit_amount` ni `total_amount`.
  La tabla de garantía todavía no existe; cuando exista, el monto retenido
  tampoco entrará, porque la función solo lee `rental_cost`.
- **Bienes sin ingresos con `0.00`.** La consulta parte de los `listings` del
  arrendador con `LEFT JOIN` a `reservations` y `simulated_payments`. Los
  filtros de estado y rango van en el `ON`, no en el `WHERE`: en el `WHERE`
  descartarían los bienes sin pagos. `ROUND(COALESCE(SUM(...), 0), 2)` deja
  siempre dos decimales, también en el cero.
- **Incluye los bienes desactivados**, con `is_active` en el resultado. Un bien
  desactivado puede haber tenido ingresos en el rango; ocultarlo haría que el
  total no cuadrara con los pagos. Si BE-21.1 decide no mostrarlos, filtra por
  `is_active`.
- **No filtra por el estado de la reserva.** Basta con que el pago sea
  `APROBADO`, como dice H21.
- **Solo los bienes del arrendador pedido.** El `WHERE l.landlord_id =
  p_landlord_id` es la única fuente de filas. BE-21.1 pasa el id del usuario
  autenticado, nunca uno recibido en la petición.
- **La fecha del ingreso es `simulated_payments.created_at` tal cual.** En
  BE-05.1 ese valor es el momento en que se **crea** el intento (`PENDIENTE`),
  unos 2 segundos antes de que la pasarela simulada lo apruebe. No hay columna
  con la hora exacta de aprobación. La diferencia solo importa si un pago cae
  justo en el borde del rango.
- **Rango `[p_from, p_to)` en UTC.** Inicio incluido y fin excluido, con
  `timestamp` sin zona, igual que `created_at`. BE-21.1 recibe `desde` y
  `hasta` como fechas inclusivas en America/El_Salvador (UTC−6, sin horario de
  verano) y las convierte a `p_from = desde 00:00 SV` y `p_to = (hasta + 1 día)
  00:00 SV`, en UTC. Por ejemplo, del 1 al 30 de noviembre:
  `[2026-11-01T06:00Z, 2026-12-01T06:00Z)`.
- **Rango invertido.** Con `p_from >= p_to` ningún pago entra y todos los
  bienes salen con `0.00`, sin error. Validar las fechas (y el máximo de 366
  días) le toca a BE-21.1.
- **Función SQL en vez de vista o de consulta suelta.** Una vista no recibe
  parámetros: el rango tendría que ir en el `WHERE` y se perderían las filas
  en `0.00`. Una consulta solo documentada no queda versionada ni se puede
  probar en la base. La función queda en la migración, se llama con un
  `$queryRaw` corto y se prueba directo contra Postgres. Es `STABLE` porque
  solo lee.
- **Cómo llega a los pagos.** La función entra por los `listings` del
  arrendador, pasa a sus `reservations` y llega al pago `APROBADO` de cada
  reserva con el único parcial `simulated_payments_one_approved_per_reservation_key`
  (`(reservation_id) WHERE status = 'APROBADO'`); el rango de `created_at` se
  filtra sobre esas filas. No usa `simulated_payments_status_created_at_idx`:
  ese índice queda disponible para consultas por rango de fechas que no pasen
  por un arrendador.

### Prueba de la consulta

[`test/reports.income.constraints.e2e-spec.ts`](../../test/reports.income.constraints.e2e-spec.ts)
crea dos arrendadores, un arrendatario y cuatro publicaciones (una
desactivada y una de otro arrendador), y comprueba:

- La suma por publicación con dos decimales (`0.10 + 0.20 = 0.30`, `25.5` →
  `25.50`), como `Decimal` y como texto.
- Que se suman varias reservas del mismo bien, y que en una reserva con dos
  `RECHAZADO` y el `APROBADO` final solo cuenta el aprobado.
- Que `PENDIENTE` y `RECHAZADO` no cuentan.
- Que el depósito no se suma, aunque sea mayor que el alquiler.
- Los bordes del rango: justo en el inicio cuenta, 1 ms antes no; 1 ms antes
  del fin cuenta, justo en el fin no.
- Un bien con pagos solo fuera del rango sale con `0.00`.
- Los bienes desactivados aparecen, con `is_active = false`.
- No aparecen bienes de otro arrendador; un usuario sin bienes no recibe filas.
- Con el rango invertido, todo sale en `0.00`.
- Con fechas `Date` de JS, el resultado es el mismo con la zona horaria de
  Node y la de la sesión de Postgres en `UTC`, `America/El_Salvador` y
  `Asia/Tokyo`.
- Que existen el índice (`pg_indexes`) y la función, con sus tipos y `STABLE`
  (`pg_proc`).

Al terminar borra los pagos, reservas, publicaciones y usuarios que creó.

```bash
# 1. Migraciones en la base de pruebas (URL que ya termina en _test)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" npx prisma migrate deploy

# 2. La prueba, con la DATABASE_URL normal del .env (el helper usa ..._test)
npx vitest run --config ./vitest.config.e2e.ts test/reports.income.constraints.e2e-spec.ts --reporter=verbose
```

En el paso 2, no dejes `DATABASE_URL` apuntando a la base `_test`: el helper
le agregaría otro `_test`.

**Migración en una base limpia.** Se comprobó creando una base vacía,
`si_be_boilerplate_clean_test`, y corriendo ahí `prisma migrate deploy`:
aplicó las 10 migraciones, y el índice y la función quedaron creados. Para
repetirlo:

```bash
docker exec si_be_postgres psql -U postgres -c "CREATE DATABASE si_be_boilerplate_clean_test"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_clean_test?schema=public" npx prisma migrate deploy
docker exec si_be_postgres psql -U postgres -d si_be_boilerplate_clean_test \
  -c "SELECT indexname FROM pg_indexes WHERE indexname = 'simulated_payments_status_created_at_idx'" \
  -c "SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'listing_income'"
```

### Qué queda para otras tasks

- **BE-21.1:** convertir `desde` y `hasta` de El Salvador a `[p_from, p_to)`
  en UTC, validar el rango, llamar a `listing_income` con el arrendador
  autenticado, sumar el total con `Decimal` y armar la respuesta.
