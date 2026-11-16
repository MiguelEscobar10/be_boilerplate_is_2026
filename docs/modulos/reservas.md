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
