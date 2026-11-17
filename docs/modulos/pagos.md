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
| `simulated_payments_status_created_at_idx` | Índice | `(status, created_at)`: pagos `APROBADO` por rango de fechas, para los ingresos por bien. Lo agrega [DB-21.1](#db-211-consulta-de-ingresos-por-bien-mp4-115). |

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
  reserva y calcular el `attempt_number` siguiente.

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

## DB-21.1. Consulta de ingresos por bien (MP4-115)

Consulta que usará BE-21.1 para el reporte de ingresos del arrendador
(historia H21). No agrega tablas ni columnas: solo un índice y una función
SQL sobre `simulated_payments`, `reservations` y `listings`.

### Modelo de datos

Migración
[`20261116180000_add_listing_income_query`](../../prisma/migrations/20261116180000_add_listing_income_query/migration.sql).

| Nombre | Tipo | Detalle |
|---|---|---|
| `simulated_payments_status_created_at_idx` | Índice | `simulated_payments (status, created_at)`, para filtrar los pagos `APROBADO` por rango. Lo genera Prisma desde `@@index([status, createdAt])`. |
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
