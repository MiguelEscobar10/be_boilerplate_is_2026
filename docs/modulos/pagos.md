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
| `rejection_reason` | `VARCHAR(200)` | sí | Motivo del rechazo. Obligatorio y no vacío si `RECHAZADO`; `NULL` en los demás estados. |
| `attempt_number` | `INTEGER` | no | Número de intento dentro de la reserva. `CHECK (BETWEEN 1 AND 3)`. |
| `transaction_number` | `VARCHAR(20)` | no | Recibo `PAG-AAAAMMDD-NNNN`. `UNIQUE` y `CHECK` de formato. |
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
| `simulated_payments_transaction_number_format_check` | CHECK | `transaction_number ~ '^PAG-[0-9]{8}-[0-9]{4}$'` |
| `simulated_payments_rejection_reason_check` | CHECK | `RECHAZADO` con motivo no vacío; los demás estados con `NULL`. |
| `simulated_payments_transaction_number_key` | UNIQUE | Un número de transacción no se repite en toda la tabla. |
| `simulated_payments_reservation_id_attempt_number_key` | UNIQUE | Un número de intento no se repite dentro de una reserva. |
| `simulated_payments_one_approved_per_reservation_key` | UNIQUE parcial | `(reservation_id) WHERE status = 'APROBADO'`: un solo pago aprobado por reserva. |
| `simulated_payments_reservation_id_created_at_id_idx` | Índice | `(reservation_id, created_at DESC, id DESC)`: historial de intentos, el más reciente primero. |

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
| `numero_transaccion` | `transaction_number` | `transactionNumber` |
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
- **El motivo depende del estado.** Es obligatorio y no vacío en un
  `RECHAZADO`, para que el arrendatario sepa por qué falló, y `NULL` en los
  demás estados.
- **`card_last4` es obligatorio.** BE-05.1 solo guarda intentos con las
  tarjetas de prueba (terminadas en `4242` o `0002`); cualquier otra devuelve
  400 sin crear fila, así que todo intento guardado tiene tarjeta. `CHAR(4)`
  rellena con espacios un valor de 3 dígitos y el `CHECK` lo rechaza.
- **`RESTRICT` hacia la reserva.** El pago es un registro financiero y el
  recibo no debe desaparecer si se borra la reserva. Es la misma regla que
  usan las reservas hacia la publicación y el arrendatario.
- **Sin triggers.** Todo lo que se valida en la base es declarativo (`CHECK`,
  `UNIQUE`, FK). Las reglas que dependen de otras tablas quedan en el servicio.

### Número de transacción (lo genera BE-05.1)

Esta task solo crea la columna `transaction_number` con sus restricciones:
`NOT NULL`, `UNIQUE` y el formato `PAG-AAAAMMDD-NNNN` (`PAG-`, 8 dígitos de
fecha, guion y 4 dígitos de consecutivo). La base **no** genera el número.

**BE-05.1** es responsable de:

- generarlo en el servidor en **cada** intento, también en los rechazados;
- que `AAAAMMDD` sea una fecha válida (el `CHECK` solo exige 8 dígitos);
- garantizar el consecutivo `NNNN` del día sin huecos ni repetidos cuando
  llegan pagos a la vez (por ejemplo, con una secuencia por día o calculándolo
  dentro de la transacción con bloqueo). Si dos pagos calculan el mismo
  número, el `UNIQUE` hace fallar al segundo, y BE-05.1 debe reintentar.

Es el recibo que ve el arrendatario (H05 y H06).

### Qué queda para otras tasks

- **BE-05.1:** generar `transaction_number` y su consecutivo, validar la
  tarjeta de prueba, copiar los importes de la reserva y calcular el
  `attempt_number` siguiente.

### Prueba de restricciones

[`test/payments.constraints.e2e-spec.ts`](../../test/payments.constraints.e2e-spec.ts)
comprueba cada restricción de la tabla: la FK, los importes negativos y en
cero, el total incoherente, los intentos 0 y 4 (y 1 a 3 válidos), el intento
repetido, el segundo `APROBADO` por reserva, que varios `RECHAZADO` convivan
con el `APROBADO` final, la tarjeta con letras, espacios, 3 y 5 dígitos, el
número de transacción con formato inválido y repetido, el motivo según el
estado, la existencia de los índices y el `RESTRICT` al borrar la reserva. Al
terminar borra los pagos, reservas, publicación y usuarios que creó.

Corre contra la misma base de pruebas que las demás:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```
