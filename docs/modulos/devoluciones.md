# Módulo 4: Devolución y resolución de la garantía

Registro de la devolución del bien y de cómo se resolvió el depósito de
garantía (historia H09). La devolución cuelga de una reserva ya entregada
(H08, [`entregas.md`](entregas.md)); al resolver la garantía la reserva pasa a
`COMPLETADA` (BE-09.2). Todo es un registro simulado: no se mueve dinero.

## DB-09.1. Devoluciones y movimientos de garantía (MP4-76)

### Modelo de datos

Migración
[`20261119054722_create_returns_and_deposit_resolutions`](../../prisma/migrations/20261119054722_create_returns_and_deposit_resolutions/migration.sql).

**Tabla `returns`** (modelo Prisma `Return`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `reservation_id` | `UUID` | no | Reserva devuelta. **Único**: una devolución por reserva. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `returned_at` | `TIMESTAMP(3)` | no | Fecha y hora real de la devolución, en UTC. La manda el arrendador. |
| `final_state` | `ReturnFinalState` | no | Estado del bien al regresar. |
| `observations` | `VARCHAR(500)` | sí | Nota general opcional. Si viene, con al menos un carácter que no sea espacio. |
| `damages` | `VARCHAR(500)` | sí | Daños o faltantes. Obligatorio con `CON_OBSERVACIONES`; `NULL` con `SIN_OBSERVACIONES`. |
| `registered_by` | `UUID` | no | Arrendador que registró la devolución. FK a `users.id`, `ON DELETE RESTRICT`. |
| `created_at` | `TIMESTAMP(3)` | no | Cuándo se guardó el registro. |

**Enum `ReturnFinalState`**: `SIN_OBSERVACIONES`, `CON_OBSERVACIONES`.

**Tabla `deposit_resolutions`** (modelo Prisma `DepositResolution`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `reservation_id` | `UUID` | no | Reserva cuya garantía se resuelve. **Único**. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `original_deposit` | `DECIMAL(12,2)` | no | Depósito de la reserva al resolver. |
| `retained_amount` | `DECIMAL(12,2)` | no | Lo que se queda el arrendador. |
| `released_amount` | `DECIMAL(12,2)` | no | Lo que se le devuelve al arrendatario. |
| `status` | `DepositStatus` | no | `RETENIDA` si se retuvo algo, `LIBERADA` si no. |
| `reason` | `VARCHAR(500)` | sí | Motivo de la retención. Obligatorio si hay retención. |
| `resolved_at` | `TIMESTAMP(3)` | no | Cuándo se resolvió. `now()` por defecto. |

**Enum `DepositStatus`**: `LIBERADA`, `RETENIDA`. Los valores de los dos enums
se quedan en español porque son los mismos que viajan en la API.

Las tablas `users` y `reservations` no cambian: las relaciones inversas
(`User.registeredReturns`, `Reservation.returnRecord`,
`Reservation.depositResolution`) existen solo en el cliente de Prisma.

### Restricciones

| Nombre | Tipo | Regla |
|---|---|---|
| `returns_reservation_id_key` | UNIQUE | Una devolución por reserva. |
| `returns_observations_check` | CHECK | `observations` es `NULL` o tiene algún carácter que no sea espacio. |
| `returns_damages_check` | CHECK | `CON_OBSERVACIONES` con `damages ~ '\S'`; `SIN_OBSERVACIONES` con `damages IS NULL`. |
| `deposit_resolutions_reservation_id_key` | UNIQUE | Una resolución por reserva. |
| `deposit_resolutions_original_deposit_check` | CHECK | `original_deposit >= 0` |
| `deposit_resolutions_retained_amount_check` | CHECK | `retained_amount >= 0` |
| `deposit_resolutions_released_amount_check` | CHECK | `released_amount >= 0` |
| `deposit_resolutions_retained_within_deposit_check` | CHECK | `retained_amount <= original_deposit` |
| `deposit_resolutions_amounts_match_deposit_check` | CHECK | `retained_amount + released_amount = original_deposit` |
| `deposit_resolutions_status_check` | CHECK | `RETENIDA` si `retained_amount > 0`; `LIBERADA` si `retained_amount = 0`. |
| `deposit_resolutions_reason_check` | CHECK | Con retención, `reason ~ '\S'`; sin retención puede ser `NULL`. |

Los `CHECK` van escritos a mano al final del `migration.sql`, porque Prisma no
los modela.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `devolucion` (tabla) | `returns` | `Return` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `fecha_real` | `returned_at` | `returnedAt` |
| `estado_final` | `final_state` | `finalState` |
| `observaciones` | `observations` | `observations` |
| `danos` | `damages` | `damages` |
| `registrada_por` | `registered_by` | `registeredById` |
| `resolucion_deposito` (tabla) | `deposit_resolutions` | `DepositResolution` |
| `deposito_original` | `original_deposit` | `originalDeposit` |
| `monto_retenido` | `retained_amount` | `retainedAmount` |
| `monto_liberado` | `released_amount` | `releasedAmount` |
| `estado` | `status` | `status` |
| `motivo` | `reason` | `reason` |
| `resuelta_at` | `resolved_at` | `resolvedAt` |

### Decisiones

- **`PENDIENTE` no se guarda.** De los tres estados de la garantía (sección
  2.3), `PENDIENTE` es una reserva sin fila en `deposit_resolutions`. Así no hay
  que crear una fila al reservar ni mantenerla sincronizada.
- **Una devolución y una resolución por reserva, en la base.** Los `UNIQUE
  (reservation_id)` hacen que una segunda falle aunque lleguen dos peticiones a
  la vez. BE-09.1 y BE-09.2 lo traducen a **409**.
- **El estado de la garantía sale del monto.** El `CHECK` no deja guardar una
  `LIBERADA` con retención ni una `RETENIDA` sin ella, y con retención exige
  el motivo.
- **Sin garantía también se cierra.** Una reserva con depósito 0 se resuelve con
  los tres importes en 0 y queda `LIBERADA`.
- **La base no exige que haya devolución antes de resolver.** Lo revisa BE-09.2
  (responde 422), igual que el paso de estado de la reserva: no hay triggers.
- **`RESTRICT` en la reserva y en el usuario**, como en la entrega: son parte
  del registro del alquiler.

### Prueba de restricciones

[`test/returns.constraints.e2e-spec.ts`](../../test/returns.constraints.e2e-spec.ts)
comprueba, en `returns`: lo que se guarda, la única devolución por reserva, el
enum, los daños obligatorios o prohibidos según el estado final, la nota de
solo espacios, el límite de 500, las FK y el `RESTRICT`. En
`deposit_resolutions`: una liberación y una retención válidas, el depósito
retenido completo y la reserva sin garantía, la única resolución por reserva,
los importes negativos, mayores al depósito o que no suman, el estado
incoherente con el monto, la retención sin motivo y el `RESTRICT`.

Corre contra la misma base de pruebas que las demás:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```
