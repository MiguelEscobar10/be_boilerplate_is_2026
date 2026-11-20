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

## BE-09.1. Registro de devolución (MP4-77)

### Endpoints

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `POST` | `/api/v1/reservas/{id}/devolucion` | `ARRENDADOR` dueño del bien | `201 { devolucionId, reservaId, devolucionRegistrada: true }` |
| `GET` | `/api/v1/reservas/{id}/devolucion` | arrendador o arrendatario de la reserva | `200 { devolucionId, reservaId, fechaReal, estadoFinal, danos }` |

El `POST` recibe JSON:

```json
{
  "fechaReal": "2026-11-12T12:15:00-06:00",
  "estadoFinal": "CON_OBSERVACIONES",
  "danos": "Rayón lateral"
}
```

- `fechaReal`: ISO 8601 con zona horaria; se guarda en UTC.
- `estadoFinal`: `SIN_OBSERVACIONES` o `CON_OBSERVACIONES`.
- `danos`: obligatorio (1 a 500 caracteres, se guarda sin los espacios de los
  extremos) con `CON_OBSERVACIONES`; ausente o vacío con `SIN_OBSERVACIONES`.

El `GET` lo agrega esta task para que se puedan consultar las observaciones
(criterio técnico) y para FE-09.1.

### Reglas (en este orden)

1. **400**: fecha que no es ISO 8601, estado final fuera del catálogo, daños
   que no corresponden al estado final o de más de 500, o un campo de más.
2. **404**: la reserva no existe. **403**: la cuenta no es `ARRENDADOR` o la
   reserva no es de un bien suyo.
3. **409**: la reserva ya tiene devolución, o no hay entrega previa (no está
   `EN_CURSO`).
4. **400**: la fecha real es anterior a la entrega (`deliveries.delivered_at`).
   Va después porque hace falta leer la entrega; se acepta la misma fecha de la
   entrega.

Ninguna regla que falle deja datos.

### La transacción

Se bloquea la fila de la reserva (`SELECT ... FOR UPDATE`), se vuelve a
comprobar que esté `EN_CURSO` y se crea la devolución. Si dos peticiones
llegan a la vez, la segunda espera el bloqueo y choca con el `UNIQUE` de
`reservation_id`: recibe **409** (hay prueba).

### Decisiones

- **La reserva sigue `EN_CURSO` después de la devolución.** Pasa a
  `COMPLETADA` cuando se resuelve la garantía (BE-09.2), que es el criterio de
  aceptación de H09: "la devolución y la garantía quedaron registradas".
- **Los identificadores son UUID**, como en el resto del proyecto (el contrato
  del brief los muestra como enteros).
- **`observations` no se llena desde la API.** El contrato de BE-09.1 solo
  trae `danos`; la columna queda disponible para una nota general.
- **No se rechaza una fecha futura.** El contrato solo pide que no anteceda a
  la entrega.

### Pruebas

- [`src/returns/services/returns.service.spec.ts`](../../src/returns/services/returns.service.spec.ts):
  el orden de las reglas (400, 404, 403, 409), la relación entre estado final y
  daños, el límite exacto de la fecha de entrega y los conflictos de la
  transacción.
- [`test/returns.e2e-spec.ts`](../../test/returns.e2e-spec.ts): devolución
  válida con y sin observaciones, la fecha con zona horaria, la segunda
  devolución (409) y dos simultáneas, reservas sin entrega, los 400, otro
  arrendador y el arrendatario (403), 401, 404, y la consulta por cada
  participante (y 404 para el resto).

## BE-09.2. Resolución del depósito y cierre (MP4-78)

### Endpoints

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `POST` | `/api/v1/reservas/{id}/deposito/resolucion` | `ARRENDADOR` dueño del bien | `200` con el estado de la garantía |
| `GET` | `/api/v1/reservas/{id}/deposito/resolucion` | arrendador o arrendatario de la reserva | `200` con el estado de la garantía |

El `POST` recibe `{ "montoRetenido": 5.00, "motivo": "Daño reportado" }` y
los dos responden:

```json
{
  "depositoOriginal": 20.0,
  "montoRetenido": 5.0,
  "montoLiberado": 15.0,
  "estadoGarantia": "RETENIDA",
  "motivo": "Daño reportado",
  "estadoReserva": "COMPLETADA",
  "simulado": true
}
```

El `GET` lo agrega esta task para FE-09.1. Antes de resolver responde
`estadoGarantia: "PENDIENTE"`, con `montoRetenido`, `montoLiberado` y `motivo`
en `null` y el `estadoReserva` actual.

### Reglas (en este orden)

1. **400**: `montoRetenido` negativo, con más de dos decimales o que no es un
   número; retención (`montoRetenido > 0`) sin `motivo`; `motivo` de más de
   500; un campo de más.
2. **404**: la reserva no existe. **403**: la cuenta no es `ARRENDADOR` o la
   reserva no es de un bien suyo.
3. **409**: la garantía ya está resuelta.
4. **422**, con `codigo` para que el frontend distinga el caso:

   | `codigo` | Cuándo | `message` |
   |---|---|---|
   | `DEVOLUCION_NO_REGISTRADA` | La reserva no tiene devolución. | Primero registra la devolución |
   | `RETENCION_SUPERA_DEPOSITO` | `montoRetenido` mayor que el depósito. | El monto retenido no puede superar el depósito |
   | `RETENCION_SIN_OBSERVACIONES` | `montoRetenido > 0` con una devolución `SIN_OBSERVACIONES`. | No se puede retener la garantía de una devolución sin observaciones |

Ninguna regla que falle deja datos: ni resolución, ni cambio de estado, ni
aviso.

### Cálculo

`montoLiberado = depósito de la reserva - montoRetenido`, con decimales exactos
(`Prisma.Decimal`), no con números de JavaScript. `estadoGarantia` es
`RETENIDA` si se retuvo algo y `LIBERADA` si no. Una reserva sin garantía
(depósito 0) se cierra con los dos importes en 0. Con una devolución
`CON_OBSERVACIONES` también se puede liberar todo (`montoRetenido = 0`).

### La transacción

Se bloquea la fila de la reserva (`SELECT ... FOR UPDATE`), se vuelve a
comprobar que esté `EN_CURSO`, se guarda la resolución y la reserva pasa a
`COMPLETADA`. Si dos peticiones llegan a la vez, la segunda recibe **409** y
no se avisa dos veces (hay prueba).

### Aviso

Después de guardar, se llama al servicio de avisos (BE-20.1):

| Campo | Valor |
|---|---|
| `destinatarioId` | El arrendatario de la reserva. |
| `titulo` | `Depósito de garantía resuelto` |
| `mensaje` | `El depósito de garantía de «<bien>» fue resuelto: monto liberado $15.00, monto retenido $5.00.` |
| `moduloOrigen` | `PAGOS_GARANTIA` |
| `referencia` | `{ tipo: 'reserva', id: <id de la reserva> }` |

Si el aviso falla, la resolución ya está guardada: se registra el error en el
log y la respuesta sigue siendo 200, igual que en los pagos.

### Decisiones

- **La referencia del aviso es la reserva.** Es lo que pide la task de BE-09.2.
  El contrato del servicio de avisos
  ([`servicio-avisos.md`](../contratos/servicio-avisos.md)) proponía
  `{ tipo: 'garantia', id }`. **Pendiente de confirmar** con quien lleva la
  bandeja; el cambio es una línea en `deposit-resolutions.service.ts`.
- **El motivo sin retención es opcional** y se guarda si viene.
- **`simulado: true` siempre.** No hay pasarela: la resolución es solo un
  registro.
- **Mismo módulo que la devolución** (`src/returns`): las dos partes de H09
  comparten la reserva y sus reglas.

### Pruebas

- [`src/returns/services/deposit-resolutions.service.spec.ts`](../../src/returns/services/deposit-resolutions.service.spec.ts):
  el cálculo a dos decimales, el orden de las reglas (400, 404, 403, 409, 422
  con su `codigo` y mensaje), el contenido del aviso y que un aviso fallido no
  rompe la resolución.
- [`test/returns.deposit.e2e-spec.ts`](../../test/returns.deposit.e2e-spec.ts):
  retención parcial y total, liberación completa, reserva sin garantía, el paso
  a `COMPLETADA`, el aviso en la bandeja del arrendatario, la segunda
  resolución (409) y dos simultáneas, los tres 422, los 400, 403, 401, 404 y la
  consulta (`PENDIENTE` antes de resolver).
