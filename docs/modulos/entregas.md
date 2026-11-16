# Módulo 4: Entrega del equipo o espacio

Registro de la entrega del equipo o del inicio del uso del espacio (historia
H08): cuándo empezó el alquiler y en qué estado estaba el bien. Al registrarla,
la reserva pasa de `CONFIRMADA` a `EN_CURSO` (BE-08.1). De aquí cuelga la
devolución (H09, DB-09.1).

## DB-08.1. Registro de entrega asociado a la reserva (MP4-72)

### Modelo de datos

Migración
[`20261116084140_create_deliveries`](../../prisma/migrations/20261116084140_create_deliveries/migration.sql).

**Tabla `deliveries`** (modelo Prisma `Delivery`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `reservation_id` | `UUID` | no | Reserva entregada. **Único**: una entrega por reserva. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `delivered_at` | `TIMESTAMP(3)` | no | Fecha y hora real de la entrega, en UTC. `now()` por defecto; la pone el servidor. |
| `initial_condition_note` | `VARCHAR(500)` | no | Estado del bien al entregarlo. `CHECK` de al menos un carácter que no sea espacio. |
| `registered_by` | `UUID` | no | Arrendador que registró la entrega. FK a `users.id`, `ON DELETE RESTRICT`. |

Índices: único `deliveries_reservation_id_key` sobre `(reservation_id)` y
`deliveries_registered_by_idx` sobre `(registered_by)`.

**Tabla `delivery_photos`** (modelo Prisma `DeliveryPhoto`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `delivery_id` | `UUID` | no | Entrega. FK a `deliveries.id`, `ON DELETE CASCADE`. |
| `path` | `TEXT` | no | Ruta privada de la foto en el almacenamiento. `CHECK` no vacía. |
| `position` | `INTEGER` | no | Orden de la foto. `CHECK (position BETWEEN 0 AND 4)`. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

Índice único `delivery_photos_delivery_id_position_key` sobre
`(delivery_id, position)`.

Las tablas `users` y `reservations` no cambian: las relaciones inversas
(`User.registeredDeliveries`, `Reservation.delivery`) existen solo en el
cliente de Prisma.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `entrega` (tabla) | `deliveries` | `Delivery` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `fecha_real` | `delivered_at` | `deliveredAt` |
| `nota_estado_inicial` | `initial_condition_note` | `initialConditionNote` |
| `registrada_por` | `registered_by` | `registeredById` |
| `entrega_foto` (tabla) | `delivery_photos` | `DeliveryPhoto` |
| `ruta_privada_o_url` | `path` | `path` |
| `orden` | `position` | `position` |

### Decisiones

- **Una entrega por reserva, en la base.** El `UNIQUE (reservation_id)` hace que
  una segunda entrega falle aunque lleguen dos peticiones a la vez. BE-08.1 lo
  traduce a **409**.
- **Hasta 5 fotos sin contar filas.** `position` va de 0 a 4 y es única por
  entrega, así que no caben más de 5. Mismo criterio que `listing_images`
  (posición única por publicación).
- **El paso a `EN_CURSO` va en la misma transacción que la entrega.** La base no
  cambia el estado sola (no hay trigger): BE-08.1 crea la entrega y actualiza la
  reserva dentro de una transacción, después de comprobar que esté
  `CONFIRMADA`, que sea del arrendador y que ya llegó `start_at`. Si la
  entrega falla (por ejemplo, duplicada), la reserva sigue `CONFIRMADA` (hay
  prueba).
- **`RESTRICT` en la reserva y en el usuario.** La entrega es parte del registro
  del alquiler (de ella cuelga la devolución de H09). Las fotos, en cambio, se
  borran con su entrega (`CASCADE`).
- **La fecha la pone el servidor.** `delivered_at` tiene `now()` por defecto y
  el cliente no la manda (contrato de BE-08.1).

### Qué queda para otras tasks

- **BE-08.1:** `POST /api/v1/reservas/{id}/entrega` (nota y hasta 5 fotos), la
  transacción con el paso a `EN_CURSO`, el 409 por duplicada y el 422
  `ENTREGA_NO_HABILITADA` antes de `start_at`. Depende de BE-04.1.
- **DB-09.1 (Elias):** la devolución y la garantía cuelgan de la reserva
  entregada.

### Prueba de restricciones

[`test/deliveries.constraints.e2e-spec.ts`](../../test/deliveries.constraints.e2e-spec.ts)
comprueba la fecha por defecto y quién registró, la única entrega por reserva,
los límites de 500 caracteres y la nota vacía o de solo espacios, las FK, el
`RESTRICT` al borrar la reserva, la transacción de entrega con el paso a
`EN_CURSO` (y que no cambia si la entrega falla), y en las fotos: hasta 5 en
orden, el rechazo de una sexta o de una posición negativa o repetida, la ruta
vacía, la FK y el borrado en cascada.

Corre contra la misma base de pruebas que las demás:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```
