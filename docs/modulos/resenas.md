# Módulo 6: Reseñas y calificaciones

Calificaciones que se dejan después de un alquiler: la del bien y del
arrendador (H17) y la del arrendatario (H18). Todas cuelgan de una reserva
`COMPLETADA`.

## DB-18.1. Calificación del arrendatario (MP4-93)

Lo que el arrendador opina del arrendatario de una reserva (H18): un puntaje de
1 a 5 y un comentario opcional. Una sola calificación por reserva.

### Modelo de datos

Migración
[`20261116232824_create_tenant_ratings`](../../prisma/migrations/20261116232824_create_tenant_ratings/migration.sql).

**Tabla `tenant_ratings`** (modelo Prisma `TenantRating`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `reservation_id` | `UUID` | no | Reserva calificada. `UNIQUE`. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `author_id` | `UUID` | no | Arrendador que califica. FK a `users.id`, `ON DELETE RESTRICT`. |
| `tenant_id` | `UUID` | no | Arrendatario calificado. FK a `users.id`, `ON DELETE RESTRICT`. |
| `score` | `SMALLINT` | no | Puntaje. `CHECK (score BETWEEN 1 AND 5)`. |
| `comment` | `VARCHAR(500)` | sí | Comentario opcional. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

Índices:

- `tenant_ratings_reservation_id_key`, único sobre `reservation_id`: impide
  calificar dos veces la misma reserva.
- `tenant_ratings_tenant_id_created_at_idx` sobre `(tenant_id, created_at
  DESC)`: las calificaciones que recibió un arrendatario, más recientes
  primero.

Restricciones `CHECK`, escritas a mano al final de la migración:

| Nombre | Regla |
|---|---|
| `tenant_ratings_score_check` | El puntaje va de 1 a 5. |
| `tenant_ratings_comment_check` | El comentario, si viene, debe tener algún carácter que no sea espacio en blanco (`~ '\S'`). |
| `tenant_ratings_author_not_tenant_check` | El autor y el arrendatario no pueden ser la misma persona. |

Las tablas `users` y `reservations` no cambian: las relaciones inversas
(`Reservation.tenantRating`, `User.tenantRatingsWritten`,
`User.tenantRatingsReceived`) existen solo en el cliente de Prisma.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `calificacion_arrendatario` (tabla) | `tenant_ratings` | `TenantRating` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `autor_id` | `author_id` | `authorId` |
| `arrendatario_id` | `tenant_id` | `tenantId` |
| `puntaje` | `score` | `score` |
| `comentario` | `comment` | `comment` |
| `created_at` | `created_at` | `createdAt` |

### Decisiones

- **`UNIQUE` en la reserva y no una consulta previa.** Si el arrendador envía
  el formulario dos veces a la vez, las dos peticiones podrían leer "no hay
  calificación" antes de insertar. Con el índice único la segunda falla en la
  base, y BE-18.1 convierte ese error en el 409 "Esta reserva ya fue
  calificada". Hay prueba con dos inserciones simultáneas.
- **`RESTRICT` en las tres claves.** La calificación es parte del historial de
  la reserva, como el pago: no desaparece si se intenta borrar la reserva o a
  alguna de las dos personas.
- **`tenant_id` repetido en esta tabla.** Ya está en la reserva, pero tenerlo
  aquí deja listar las calificaciones de un arrendatario (o promediarlas) sin
  pasar por sus reservas. BE-18.1 lo copia de la reserva al guardar.
- **La base no revisa que la reserva esté `COMPLETADA` ni que el autor sea el
  dueño del bien.** Son reglas que cruzan tablas (422 y 404 en BE-18.1) y un
  `CHECK` no puede mirar otra tabla. Lo que sí garantiza la base es el puntaje,
  el largo del comentario y que haya una sola calificación por reserva.
- **El largo del comentario lo da el tipo.** `VARCHAR(500)` cuenta caracteres,
  no bytes: 500 letras con tilde o `ñ` caben. BE-18.1 debe recortarlo con
  `trim()` y guardar `NULL` si queda vacío.
- **Sin `updated_at`.** Ninguna historia permite editar o borrar una
  calificación.

### Cómo revertir la migración

```sql
DROP TABLE "tenant_ratings";
```

No toca ninguna otra tabla, así que las reservas quedan igual.

### Prueba de restricciones

[`test/tenant-ratings.constraints.e2e-spec.ts`](../../test/tenant-ratings.constraints.e2e-spec.ts)
(`npm run test:e2e`, contra la base `_test`): se guarda con su reserva, autor y
arrendatario, con y sin comentario; los puntajes de 1 a 5 entran y 0, 6, -1 y
100 no; una segunda calificación de la misma reserva se rechaza, también cuando
las dos llegan a la vez; comentario de 500 y de 501 caracteres, con `ñ`, vacío
y de solo espacios; nadie se califica a sí mismo; las tres FK; el `RESTRICT` al
borrar la reserva, al autor o al arrendatario; y los índices.

Quité cada `CHECK` y el índice único por separado en la base de pruebas y en
los cuatro casos la prueba falla.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```

## BE-18.1. Calificar al arrendatario (MP4-94)

El arrendador califica al arrendatario de una reserva `COMPLETADA` de uno de
sus bienes (H18). Usa la tabla `tenant_ratings` de DB-18.1.

```
src/tenant-ratings/
  controllers/tenant-ratings.controller.ts   POST /reservas/:id/calificacion-arrendatario
  services/tenant-ratings.service.ts         dueño, estado y respuesta
  repositories/tenant-rating.repository.ts   lectura de la reserva e inserción
  errors/rating-errors.ts                    el 409 y el 422 con su `codigo`
  dto/
```

Módulo `TenantRatingsModule`, alias `@TenantRatings`.

### `POST /api/v1/reservas/{id}/calificacion-arrendatario`

Solo rol `ARRENDADOR`.

```json
{ "puntaje": 5, "comentario": "Devolvió el equipo a tiempo" }
```

- `puntaje`: número entero de 1 a 5. Un `"5"` en texto o un `4.5` es 400.
- `comentario`: opcional, hasta 500 caracteres. Se guarda recortado; si queda
  vacío, sin comentario.

Respuesta `201 { "id": "c0ffee00-..." }`.

| Estado | `codigo` | Cuándo |
|---|---|---|
| 201 | | Se guardó. El arrendatario sale de la reserva, no del body. |
| 400 | | Puntaje que falta, fuera de 1 a 5 o no entero; comentario de más de 500 caracteres o que no es texto; una propiedad de más; id que no es UUID. El mensaje dice qué corregir (H18, criterio 5). |
| 401 | | Sin sesión. |
| 403 | | La cuenta no es `ARRENDADOR`. |
| 404 | | La reserva no existe o es de un bien de otro arrendador ("La reserva no existe."). |
| 409 | `RESERVA_YA_CALIFICADA` | Ya fue calificada ("Esta reserva ya fue calificada."). |
| 422 | `RESERVA_NO_COMPLETADA` | No está `COMPLETADA` ("Solo puedes calificar al arrendatario de una reserva COMPLETADA."). |

### Decisiones

- **Una reserva ajena es 404, no 403**, como pide la ficha: así no se revela
  que la reserva existe. El dueño se revisa antes que el estado, para que una
  reserva ajena sin terminar tampoco dé pistas (404, no 422).
- **El 409 lo da el índice único de DB-18.1**, no una consulta previa. Con dos
  envíos a la vez, la base deja pasar uno y el otro recibe 409 (hay prueba).
- **El `arrendatario_id` se copia de la reserva.** No viene en el body, así
  que nadie puede calificar a otra persona.
- **Sin aviso al arrendatario.** La historia y el contrato del servicio de
  avisos no lo piden.

### Cambio en "Mis solicitudes" (BE-04.1)

Cada solicitud de `GET /api/v1/arrendador/solicitudes` trae ahora
`arrendatarioCalificado: true | false`. El formulario de FE-18.1 muestra
"Calificar al arrendatario" solo en las `COMPLETADA` que lo tienen en
`false`, y la tabla del wireframe (`?estado=COMPLETADA`) sale de esa misma
ruta. Ver la sección BE-04.1 en [`reservas.md`](./reservas.md).

### Pruebas

- **Unitarias**
  ([`tenant-ratings.service.spec.ts`](../../src/tenant-ratings/services/tenant-ratings.service.spec.ts),
  `npm test`): lo que se guarda, comentario vacío como `null`, 404 por
  inexistente y por ajena con el mismo texto, el orden entre dueño y estado,
  422 en cada estado que no es `COMPLETADA`, el 409 y los errores que se
  propagan.
- **E2e** ([`test/tenant-ratings.e2e-spec.ts`](../../test/tenant-ratings.e2e-spec.ts),
  `npm run test:e2e`): la app completa contra la base `_test`. Lo guardado
  en la base, puntajes 1 y 5, comentario vacío, recortado y de 500
  caracteres; el 409 y dos envíos a la vez; el 422 en cada estado; 401, 403
  y los dos 404; todos los 400; y que el panel de solicitudes marca las
  reservas ya calificadas.

Las reservas `COMPLETADA` de la prueba se crean directo en la base, porque
llegar a ese estado requiere la devolución (BE-09.2), que todavía no está en
`main`. Quité la regla de `COMPLETADA` y la del dueño por separado y en los
dos casos la prueba falla.

