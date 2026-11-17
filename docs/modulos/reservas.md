# Módulo 3: Reservas y calendario de disponibilidad

Solicitudes de alquiler de un equipo o espacio para un período (historia H03)
y períodos en los que el arrendador bloquea una publicación (H14). De aquí
cuelgan la aprobación (H04), el pago (H05), la garantía (H09), la mensajería
de la reserva (H16) y la calificación (H17, H18).

## DB-03.1. Reservas y períodos bloqueados (MP4-48)

### Modelo de datos

Migración
[`20261115234520_create_reservations`](../../prisma/migrations/20261115234520_create_reservations/migration.sql).

**Tabla `reservations`** (modelo Prisma `Reservation`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `listing_id` | `UUID` | no | Publicación reservada. FK a `listings.id`, `ON DELETE RESTRICT`. |
| `tenant_id` | `UUID` | no | Arrendatario que solicita. FK a `users.id`, `ON DELETE RESTRICT`. |
| `start_at` | `TIMESTAMP(3)` | no | Inicio del período, en UTC. |
| `end_at` | `TIMESTAMP(3)` | no | Fin del período, en UTC. `CHECK (start_at < end_at)`. |
| `status` | `ReservationStatus` | no | Estado de la reserva. `PENDIENTE` por defecto. |
| `rental_cost` | `DECIMAL(12,2)` | no | Costo del alquiler al reservar. `CHECK (rental_cost >= 0)`. |
| `deposit_amount` | `DECIMAL(12,2)` | no | Depósito al reservar, aparte del costo. `CHECK (deposit_amount >= 0)`. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

Índice `reservations_listing_id_status_start_at_end_at_idx` sobre
`(listing_id, status, start_at, end_at)`: sirve para buscar las reservas
`CONFIRMADA` o `EN_CURSO` de una publicación que se cruzan con un rango
(`WHERE listing_id = ? AND status IN (...) AND start_at < :fin AND end_at > :inicio`).

**Enum `ReservationStatus`**: `PENDIENTE`, `CONFIRMADA`, `RECHAZADA`,
`CANCELADA`, `EN_CURSO`, `COMPLETADA` (sección 2.3 del documento de
historias). Los valores se quedan en español porque son los mismos que viajan
en la API (`estado`). `CANCELADA` está previsto en el modelo, pero ninguna
historia lo produce.

**Tabla `availability_blocks`** (modelo Prisma `AvailabilityBlock`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `listing_id` | `UUID` | no | Publicación bloqueada. FK a `listings.id`, `ON DELETE CASCADE`. |
| `start_at` | `TIMESTAMP(3)` | no | Inicio del bloqueo, en UTC. |
| `end_at` | `TIMESTAMP(3)` | no | Fin del bloqueo, en UTC. `CHECK (start_at < end_at)`. |
| `reason` | `VARCHAR(200)` | sí | Motivo que escribe el arrendador. |

Las tablas `users` y `listings` no cambian: las relaciones inversas
(`User.reservations`, `Listing.reservations`, `Listing.availabilityBlocks`)
existen solo en el cliente de Prisma.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `reserva` (tabla) | `reservations` | `Reservation` |
| `publicacion_id` | `listing_id` | `listingId` |
| `arrendatario_id` | `tenant_id` | `tenantId` |
| `inicio` | `start_at` | `startAt` |
| `fin` | `end_at` | `endAt` |
| `estado` | `status` | `status` |
| `costo_alquiler` | `rental_cost` | `rentalCost` |
| `deposito_monto` | `deposit_amount` | `depositAmount` |
| `created_at` | `created_at` | `createdAt` |
| `bloqueo_disponibilidad` (tabla) | `availability_blocks` | `AvailabilityBlock` |
| `motivo` | `reason` | `reason` |

### Decisiones

- **`RESTRICT` en la publicación y en el arrendatario.** La reserva es el
  registro del alquiler: el pago, la garantía, los mensajes y las
  calificaciones cuelgan de ella, así que no debe desaparecer si se borra la
  publicación o el usuario. Los bloqueos, en cambio, no tienen sentido sin su
  publicación y se borran con ella (`CASCADE`).
- **Fechas en UTC.** `start_at` y `end_at` son `TIMESTAMP(3)` sin zona, como el
  resto de las fechas del esquema. La API recibe fechas con su desfase
  (`2026-11-12T09:00:00-06:00`) y BE-03.1 las convierte a UTC al guardar.
- **Costo y depósito son una fotografía del precio.** No tienen valor por
  defecto: el servicio de BE-03.1 los copia siempre al crear la solicitud, así
  que si olvida uno falla en vez de guardar `0`. Si la tarifa de la publicación
  cambia después, la reserva conserva lo que se acordó.
- **Los `CHECK` van a mano en la migración.** Prisma no modela restricciones
  `CHECK`; se agregaron al final del `migration.sql` con nombre propio para que
  el error diga qué regla se rompió.
- **La base no impide que dos reservas se crucen.** Una solicitud `PENDIENTE`
  no ocupa fechas y varias pueden cruzarse. Solo `CONFIRMADA` y `EN_CURSO`
  ocupan fechas, y evitar el conflicto entre ellas es trabajo de la
  transacción de aprobación (DB-04.1 y BE-04.1, con bloqueo de la fila de la
  publicación). Esta task deja el índice que esa consulta necesita.

### Qué queda para otras tasks

- **DB-04.1 (reservas):** `decidida_at`, `decidida_por` y `motivo_rechazo`.
- **DB-14.1 (bloqueos):** `created_by`, `created_at` y el índice
  `(listing_id, start_at, end_at)` para consultar traslapes. El motivo de 200
  caracteres, la FK a la publicación y `start_at < end_at` ya vienen de esta
  task, así que esa migración no necesita repetirlos.

### Prueba de restricciones

[`test/reservations.constraints.e2e-spec.ts`](../../test/reservations.constraints.e2e-spec.ts)
comprueba los valores por defecto, el redondeo a dos decimales, los seis
estados y el rechazo de uno fuera del enum, el período inválido (fin igual o
anterior al inicio) en reservas y bloqueos, los importes negativos, las FK, el
comportamiento al borrar (`RESTRICT` y `CASCADE`), el límite de 200 caracteres
del motivo, la existencia del índice y la búsqueda de solapamientos
(`CONFIRMADA` y `EN_CURSO` entran; `PENDIENTE`, `RECHAZADA` y las de otro rango
no).

Corre contra la misma base de pruebas que las de notificaciones y publicaciones:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```

## DB-04.1. Control transaccional de estados de reserva (MP4-52)

Lo que necesita la base para que aprobar o rechazar una reserva (H04) no deje
datos inconsistentes: dónde se guarda la decisión y cómo se evita que dos
aprobaciones simultáneas confirmen reservas que se cruzan.

### Modelo de datos

Migración
[`20261116231512_add_reservation_decision`](../../prisma/migrations/20261116231512_add_reservation_decision/migration.sql).
Agrega tres columnas opcionales a `reservations`:

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `decided_at` | `TIMESTAMP(3)` | sí | Fecha de la decisión, en UTC. |
| `decided_by` | `UUID` | sí | Arrendador que decidió. FK a `users.id`, `ON DELETE RESTRICT`. |
| `rejection_reason` | `VARCHAR(500)` | sí | Motivo del rechazo, opcional. |

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `decidida_at` | `decided_at` | `decidedAt` |
| `decidida_por` | `decided_by` | `decidedById` (relación `decidedBy`) |
| `motivo_rechazo` | `rejection_reason` | `rejectionReason` |

Restricciones `CHECK`, escritas a mano al final de la migración:

| Nombre | Regla |
|---|---|
| `reservations_decision_pair_check` | `decided_at` y `decided_by` van los dos o ninguno. |
| `reservations_pending_undecided_check` | Una reserva `PENDIENTE` no tiene decisión. |
| `reservations_rejection_reason_check` | El motivo solo existe si el estado es `RECHAZADA` y debe tener algún carácter que no sea espacio en blanco (`~ '\S'`). |

En el esquema de Prisma, `Reservation` ahora tiene dos relaciones con `User`,
así que llevan nombre: `ReservationTenant` (la que ya existía, `tenant`) y
`ReservationDecidedBy` (`decidedBy`). `User.reservations` sigue siendo las
reservas del arrendatario; las que decidió están en `User.decidedReservations`.
La tabla `users` no cambia.

### Índice de solapamientos

No se crea ningún índice: el de DB-03.1,
`reservations_listing_id_status_start_at_end_at_idx` sobre
`(listing_id, status, start_at, end_at)`, ya sirve para buscar las reservas
incompatibles con una aprobación. La prueba comprueba que sigue existiendo,
que no está duplicado y que el plan de esta consulta lo usa:

```sql
SELECT id FROM reservations
WHERE listing_id = :publicacion
  AND status IN ('CONFIRMADA', 'EN_CURSO')
  AND start_at < :fin AND end_at > :inicio;
```

Dos períodos se cruzan si cada uno empieza antes de que termine el otro. Los
extremos no cuentan: una reserva que termina a las 12:00 no choca con otra que
empieza a las 12:00.

### Estrategia de aprobación

Para aprobar, BE-04.1 hace todo dentro de **una transacción** y en este orden:

1. **Bloquea la fila de la publicación**:
   `SELECT id FROM listings WHERE id = :publicacion FOR UPDATE`.
2. Vuelve a leer la reserva y comprueba que siga `PENDIENTE`. Si no, 409.
3. Busca reservas `CONFIRMADA` o `EN_CURSO` de esa publicación que se crucen
   con el período (consulta de arriba) y bloqueos de `availability_blocks` que
   se crucen. Si hay alguno, 409.
4. Actualiza la reserva a `CONFIRMADA` con `decided_at` y `decided_by`.
5. Confirma la transacción. El aviso al arrendatario se envía después, fuera
   de la transacción (ver el contrato del servicio de avisos).

- **Por qué se bloquea la publicación y no la reserva.** Dos solicitudes que se
  cruzan son filas distintas: bloquear cada una no impide que las dos
  transacciones lean "no hay conflicto" y confirmen a la vez. La publicación es
  la fila que tienen en común. Con el `FOR UPDATE`, la segunda transacción
  espera a que termine la primera y, cuando sigue, ya ve la reserva confirmada
  y responde 409.
- **Sirve con el aislamiento por defecto** (`READ COMMITTED`): cada consulta
  posterior al bloqueo ve lo que la otra transacción ya confirmó. No hace falta
  `SERIALIZABLE` ni reintentos.
- **Todo lo que ocupe fechas debe tomar el mismo bloqueo.** Si BE-14.1 crea un
  bloqueo de fechas sin bloquear la publicación, puede cruzarse con una
  aprobación en curso. Lo mismo para cualquier otro cambio de estado que
  dependa de la disponibilidad.
- **Rechazar no necesita el bloqueo de la publicación**, porque no ocupa
  fechas. Basta con un `UPDATE ... WHERE id = :id AND status = 'PENDIENTE'` y
  revisar que haya cambiado una fila, para que una solicitud no se decida dos
  veces.
- **Las otras solicitudes `PENDIENTE` que se cruzan no se tocan** (H04,
  criterio 7): quedan `PENDIENTE` y, si se intenta aprobarlas, el paso 3
  encuentra el conflicto.

### Decisiones

- **La base no exige decisión en una reserva `CONFIRMADA` o `RECHAZADA`.** Las
  reservas anteriores a esta migración no la tienen, y las pruebas de otros
  módulos crean reservas `CONFIRMADA` directo en la base. Exigirla rompería
  esas filas. Que toda decisión nueva quede registrada es responsabilidad de
  BE-04.1.
- **`RESTRICT` en `decided_by`.** Quien decidió es parte del registro de la
  reserva, igual que el arrendatario.
- **El motivo solo en `RECHAZADA`.** Así un motivo no queda colgado en una
  reserva que después cambia de estado por error. El largo máximo lo da el
  tipo (`VARCHAR(500)`, 500 caracteres, no bytes). BE-04.1 debe recortarlo con
  `trim()` y guardar `NULL` si queda vacío, porque la base rechaza un motivo
  de solo espacios.

### Cómo revertir la migración

Prisma no genera migraciones de reversa. Si hay que deshacerla a mano:

```sql
ALTER TABLE "reservations"
  DROP CONSTRAINT "reservations_rejection_reason_check",
  DROP CONSTRAINT "reservations_pending_undecided_check",
  DROP CONSTRAINT "reservations_decision_pair_check",
  DROP CONSTRAINT "reservations_decided_by_fkey",
  DROP COLUMN "rejection_reason",
  DROP COLUMN "decided_by",
  DROP COLUMN "decided_at";
```

Lo probé en una base aparte con seis reservas, una por estado: al aplicar la
migración siguen las seis con las columnas nuevas en `NULL`, y al revertir
siguen las seis con las nueve columnas de DB-03.1. Solo se pierden las
decisiones registradas, que es lo que la migración agrega.

### Prueba de restricciones

[`test/reservations.decision.constraints.e2e-spec.ts`](../../test/reservations.decision.constraints.e2e-spec.ts)
(`npm run test:e2e`, contra la base `_test`):

- **Columnas:** una solicitud nueva no tiene decisión; se guardan fecha y autor
  al confirmar; rechazo con y sin motivo; motivo de 500 caracteres sí y de 501
  no; motivo vacío o de solo espacios; motivo en una reserva que no está
  `RECHAZADA`; fecha sin autor y autor sin fecha; `PENDIENTE` con decisión; la
  FK y el `RESTRICT` de `decided_by`.
- **Índice:** existe, no está duplicado y la consulta de solapamientos lo usa.
- **Estrategia de aprobación:** con la secuencia de arriba, de dos aprobaciones
  simultáneas que se cruzan solo se confirma una y la otra queda `PENDIENTE`;
  la misma solicitud aprobada dos veces a la vez se decide una sola vez; dos
  que no se cruzan se confirman las dos; y la segunda transacción espera en el
  `FOR UPDATE` hasta que termina la primera.

Quité cada `CHECK` por separado en la base de pruebas y en los tres casos la
prueba falla.

## DB-14.1. Restricciones de los bloqueos de disponibilidad (MP4-60)

Completa la tabla `availability_blocks` que creó DB-03.1 para que BE-14.1
pueda registrar quién bloqueó las fechas (H14) y consultar traslapes rápido.

### Modelo de datos

Migración
[`20261116232415_complete_availability_blocks`](../../prisma/migrations/20261116232415_complete_availability_blocks/migration.sql).

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `created_by` | `UUID` | sí | Arrendador que creó el bloqueo. FK a `users.id`, `ON DELETE RESTRICT`. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. `CURRENT_TIMESTAMP` por defecto. |

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `creado_por` | `created_by` | `createdById` (relación `createdBy`) |
| `created_at` | `created_at` | `createdAt` |

- **Índice** `availability_blocks_listing_id_start_at_end_at_idx` sobre
  `(listing_id, start_at, end_at)`, para buscar los bloqueos de una
  publicación que se cruzan con un rango
  (`WHERE listing_id = ? AND start_at < :fin AND end_at > :inicio`).
- **`CHECK availability_blocks_reason_check`**: el motivo es opcional, pero si
  viene debe tener algún carácter que no sea espacio en blanco (`~ '\S'`).

Lo demás que pide la task ya viene de DB-03.1 y no se repite: `start_at <
end_at` (`availability_blocks_period_check`), el motivo de 200 caracteres y la
FK a la publicación con `CASCADE`.

### Decisiones

- **`created_by` admite `NULL` en la base.** Las pruebas de otros módulos
  (reportes, las restricciones de DB-03.1) crean bloqueos directo en la tabla
  sin autor, y con `NOT NULL` dejarían de pasar. BE-14.1 lo guarda siempre: el
  autor es el arrendador autenticado, que además tiene que ser el dueño.
- **Los bloqueos que ya existían reciben autor.** La migración les asigna el
  dueño de la publicación, que es el único que puede bloquear. Y un motivo de
  solo espacios pasa a `NULL` para que cumpla el `CHECK` nuevo. Lo probé en
  una base aparte con tres bloqueos anteriores a la migración: quedan los tres,
  con autor y con `created_at`.
- **`RESTRICT` en `created_by`**, igual que el dueño en `listings`. Para borrar
  al usuario primero se borra su publicación, y con ella sus bloqueos.
- **La base no impide que un bloqueo se cruce con una reserva.** Eso lo revisa
  BE-14.1 antes de insertar (409 si hay una `CONFIRMADA` o `EN_CURSO`), dentro
  de una transacción que bloquea la fila de la publicación, como la aprobación
  de DB-04.1. Dos bloqueos sí pueden cruzarse entre sí: no hace daño.

### Cómo revertir la migración

```sql
ALTER TABLE "availability_blocks"
  DROP CONSTRAINT "availability_blocks_reason_check",
  DROP CONSTRAINT "availability_blocks_created_by_fkey",
  DROP COLUMN "created_by",
  DROP COLUMN "created_at";
DROP INDEX "availability_blocks_listing_id_start_at_end_at_idx";
```

### Prueba de restricciones

[`test/availability-blocks.constraints.e2e-spec.ts`](../../test/availability-blocks.constraints.e2e-spec.ts)
(`npm run test:e2e`, contra la base `_test`): autor y fecha de creación, bloqueo
sin autor, la FK y el `RESTRICT` de `created_by`, fin igual o anterior al
inicio, motivo de 200 y de 201 caracteres, motivo vacío o de solo espacios, que
el índice existe y que la consulta de traslapes lo usa, y que esa consulta
devuelve solo los bloqueos de la publicación que se cruzan con el rango (los
que tocan el borde no cuentan).

Quité el `CHECK` del motivo y el índice por separado en la base de pruebas y en
los dos casos la prueba falla.

## DB-13.1. Consulta de días ocupados (MP4-56)

La consulta que usa el calendario de disponibilidad (H13): qué períodos de una
publicación están ocupados dentro de un rango de fechas.

### La función `listing_busy_periods`

Migración
[`20261116232629_create_listing_busy_periods`](../../prisma/migrations/20261116232629_create_listing_busy_periods/migration.sql).
No crea tablas ni índices: es una función SQL de solo lectura.

```sql
SELECT * FROM listing_busy_periods(:publicacion, :desde, :hasta);
```

| Parámetro | Tipo | Descripción |
|---|---|---|
| `p_listing_id` | `UUID` | Publicación. |
| `p_from` | `TIMESTAMP(3)` | Inicio del rango, en UTC, incluido. |
| `p_to` | `TIMESTAMP(3)` | Fin del rango, en UTC, excluido. |

| Columna | Tipo | Descripción |
|---|---|---|
| `start_at` | `TIMESTAMP(3)` | Inicio del período ocupado, en UTC. |
| `end_at` | `TIMESTAMP(3)` | Fin del período ocupado, en UTC. |
| `source` | `TEXT` | `RESERVA` o `BLOQUEO`. |

Reglas:

- **Ocupan fechas** las reservas `CONFIRMADA` o `EN_CURSO` y los bloqueos del
  arrendador. Una solicitud `PENDIENTE` no aparta fechas (H13, criterio 2), y
  `RECHAZADA`, `CANCELADA` y `COMPLETADA` tampoco entran.
- **Un período entra si se cruza con el rango**: `start_at < p_to AND end_at >
  p_from`. Tocar el borde no cuenta: una reserva que termina justo en `p_from`
  no aparece.
- **Los períodos salen completos**, sin recortarlos al rango, ordenados por
  inicio. Si una reserva y un bloqueo caen sobre los mismos días salen los
  dos: la función no fusiona, eso lo decide quien pinta el calendario.
- **Solo inicio, fin y origen.** No devuelve quién reservó ni el motivo del
  bloqueo, que es lo que BE-13.1 no puede exponer en una ruta pública.

Desde el backend se llama con `$queryRaw`, convirtiendo las fechas a
`timestamp`:

```ts
const ocupados = await prisma.$queryRaw<
  { start_at: Date; end_at: Date; source: 'RESERVA' | 'BLOQUEO' }[]
>`SELECT * FROM listing_busy_periods(
    ${publicacionId}::uuid, ${desde}::timestamp, ${hasta}::timestamp)`;
```

### Índices

No se agrega ninguno. La función usa los dos que ya existen:

- `reservations_listing_id_status_start_at_end_at_idx` (DB-03.1) para las
  reservas.
- `availability_blocks_listing_id_start_at_end_at_idx` (DB-14.1) para los
  bloqueos.

Como la función es `LANGUAGE sql` y `STABLE`, Postgres la expande dentro de la
consulta que la llama y el plan muestra los dos índices. La prueba lo comprueba
con `EXPLAIN`.

### Decisiones

- **Una función en la base y no una consulta en el repositorio.** Es lo mismo
  que hizo DB-22.1 con el reporte de ocupación: la regla de qué ocupa fechas
  queda en un solo lugar y se prueba sin levantar la API.
- **No reutiliza `listing_day_occupancy` de DB-22.1.** Esa función responde
  otra pregunta (día por día, en hora de El Salvador y contando `COMPLETADA`,
  para el reporte). El calendario necesita los períodos con su hora exacta y
  solo lo que ocupa fechas hacia adelante.
- **Rango en UTC.** La función compara contra las columnas tal como están
  guardadas. Convertir el `desde` y `hasta` de la API (fechas en hora local) a
  UTC es trabajo de BE-13.1.

### Cómo revertir la migración

```sql
DROP FUNCTION "listing_busy_periods"(UUID, TIMESTAMP(3), TIMESTAMP(3));
```

### Prueba

[`test/availability.busy-periods.e2e-spec.ts`](../../test/availability.busy-periods.e2e-spec.ts)
(`npm run test:e2e`, contra la base `_test`): publicación sin nada; reservas
`CONFIRMADA` y `EN_CURSO` y bloqueos con su origen y en orden; `PENDIENTE`,
`RECHAZADA`, `CANCELADA` y `COMPLETADA` no ocupan; lo que queda fuera del rango
o solo toca el borde no entra y lo que cruza el borde sale completo; un período
que cubre todo el rango; no mezcla otra publicación; reserva y bloqueo sobre
los mismos días; no expone columnas de más; y usa los dos índices sin
duplicarlos.

## BE-13.1. Consulta de disponibilidad (MP4-57)

Endpoint que usa el calendario del detalle de un bien (H13) para saber qué
días están ocupados.

```
src/availability/
  controllers/availability.controller.ts   AvailabilityController
  services/availability.service.ts         valida el rango y arma la respuesta
  services/local-time.ts                   fechas en hora de El Salvador
  repositories/availability.repository.ts  llama a listing_busy_periods (DB-13.1)
  dto/                                     query y respuesta
```

Es un módulo aparte (`AvailabilityModule`, alias `@Availability`) y no parte
de publicaciones ni de reservas, porque ahí también va a ir el bloqueo de
fechas de BE-14.1. Importa `ListingsModule` para resolver el 404.

### `GET /api/v1/publicaciones/{id}/disponibilidad`

Ruta **pública** (`@Public()`), sin body.

| Query | Obligatorio | Descripción |
|---|---|---|
| `desde` | sí | Primer día del rango, `AAAA-MM-DD`, incluido. |
| `hasta` | sí | Último día del rango, `AAAA-MM-DD`, incluido. |

```
GET /api/v1/publicaciones/7c1e0f3a-.../disponibilidad?desde=2026-11-01&hasta=2026-11-30
```

```json
{
  "publicacionId": "7c1e0f3a-2b4d-4c6e-8f90-a1b2c3d4e5f6",
  "desde": "2026-11-01",
  "hasta": "2026-11-30",
  "ocupados": [
    { "inicio": "2026-11-12T09:00:00-06:00", "fin": "2026-11-12T12:00:00-06:00", "origen": "RESERVA" },
    { "inicio": "2026-11-20T00:00:00-06:00", "fin": "2026-11-22T00:00:00-06:00", "origen": "BLOQUEO" }
  ]
}
```

- `ocupados` trae las reservas `CONFIRMADA` o `EN_CURSO` y los bloqueos que se
  cruzan con el rango, en orden por inicio. **Lo que no aparece está libre.**
  Una solicitud `PENDIENTE` no aparece.
- Cada período es `[inicio, fin)`: el `fin` no está incluido. Un bloqueo con
  `fin` el 22 a las 00:00 deja libre el 22.
- Los períodos salen completos aunque crucen el borde del rango, y si una
  reserva y un bloqueo caen sobre los mismos días salen los dos. El frontend
  es quien marca los días.
- No devuelve quién reservó ni el motivo del bloqueo.

| Estado | Cuándo |
|---|---|
| 200 | Rango válido y publicación activa, aunque no tenga nada ocupado (`ocupados: []`). |
| 400 | Falta `desde` o `hasta`, el formato no es `AAAA-MM-DD`, la fecha no existe (`2026-02-30`), `hasta` es anterior a `desde`, el rango pasa de 92 días, viene un parámetro que no es de esta query o el id no es un UUID. |
| 404 | La publicación no existe o está desactivada. |

Los errores tienen la forma estándar de Nest, como el resto de la API:
`{ "statusCode": 400, "message": "...", "error": "Bad Request" }`.

### Decisiones

- **Fechas en hora de El Salvador.** `desde=2026-11-01` es el 1 de noviembre a
  las 00:00 de aquí, que en la base (UTC) son las 06:00. El Salvador está en
  UTC-6 todo el año, sin horario de verano, así que la conversión es un
  desfase fijo (`services/local-time.ts`) y no hace falta una librería de
  zonas horarias. La respuesta va con `-06:00`, como en el contrato. Es la
  misma zona que usa el reporte de ocupación de BE-22.1.
- **`hasta` va incluido.** `desde=2026-11-01&hasta=2026-11-30` es noviembre
  completo: una reserva del 30 por la noche entra, aunque en UTC ya sea 1 de
  diciembre. Hay prueba de ese borde.
- **92 días como máximo, contando los dos extremos.** Alcanza para tres meses
  seguidos de calendario (31 + 31 + 30). El calendario pide de mes en mes.
- **Primero se valida el rango y después la publicación.** Un rango inválido
  da 400 aunque la publicación no exista, sin tocar la base.
- **El 404 es el de publicaciones.** Se reutiliza `ListingsService.findById`,
  así que una publicación inactiva responde igual que en `GET
  /publicaciones/{id}`.
- **Los ids son UUID**, no enteros como en el ejemplo del brief (`17`), igual
  que en el resto del proyecto.

### Pruebas

- **Unitarias**
  ([`availability.service.spec.ts`](../../src/availability/services/availability.service.spec.ts),
  `npm test`): la conversión de fechas (inicio del día, fechas que no existen,
  año bisiesto, formato con `-06:00`), el rango que se le pasa al repositorio,
  la forma de la respuesta, 92 días sí y 93 no, `hasta` anterior a `desde`, y
  que con un rango inválido o una publicación inexistente no se consulta la
  disponibilidad.
- **E2e** ([`test/availability.e2e-spec.ts`](../../test/availability.e2e-spec.ts),
  `npm run test:e2e`): la app completa contra la base `_test`.
  - Sin token responde 200.
  - `CONFIRMADA`, `EN_CURSO` y bloqueos aparecen en orden y en hora local;
    `PENDIENTE`, `RECHAZADA`, `CANCELADA` y `COMPLETADA` no.
  - La respuesta no contiene ids de usuarios ni el motivo del bloqueo.
  - Bordes del rango en hora local, rango de un día y de 92 días.
  - Todos los casos de 400 y de 404, y que `GET /publicaciones/{id}` sigue
    respondiendo.

Las reservas de la prueba se crean directo en la base con el estado que cada
caso necesita, porque BE-03.1 y BE-04.1 todavía no están en `main`.

