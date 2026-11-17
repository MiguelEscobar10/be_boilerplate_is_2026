# Módulo 6: Reseñas y calificaciones

Calificaciones que se dejan después de un alquiler: la del bien y del
arrendador (H17) y la del arrendatario (H18). Todas cuelgan de una reserva
`COMPLETADA`.

## DB-17.1. Calificación del bien y del arrendador (MP4-89)

Lo que el arrendatario opina, al terminar una reserva, del bien que rentó y de
su arrendador (H17): un puntaje de 1 a 5 para cada uno, por separado, y un
comentario opcional. Una sola calificación por reserva.

### Modelo de datos

Migración
[`20261117053332_create_listing_landlord_ratings`](../../prisma/migrations/20261117053332_create_listing_landlord_ratings/migration.sql).

**Tabla `listing_landlord_ratings`** (modelo Prisma `ListingLandlordRating`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `reservation_id` | `UUID` | no | Reserva calificada. `UNIQUE`. FK a `reservations.id`, `ON DELETE RESTRICT`. |
| `author_id` | `UUID` | no | Arrendatario que califica (el de la reserva). FK a `users.id`, `ON DELETE RESTRICT`. |
| `listing_id` | `UUID` | no | Publicación calificada (la de la reserva). FK a `listings.id`, `ON DELETE RESTRICT`. |
| `landlord_id` | `UUID` | no | Arrendador calificado (el dueño de la publicación). FK a `users.id`, `ON DELETE RESTRICT`. |
| `listing_score` | `SMALLINT` | no | Puntaje del bien. `CHECK (listing_score BETWEEN 1 AND 5)`. |
| `landlord_score` | `SMALLINT` | no | Puntaje del arrendador. `CHECK (landlord_score BETWEEN 1 AND 5)`. |
| `comment` | `VARCHAR(500)` | sí | Comentario opcional. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

Índices:

- `listing_landlord_ratings_reservation_id_key`, único sobre `reservation_id`:
  impide calificar dos veces la misma reserva.
- `listing_landlord_ratings_listing_id_idx` sobre `(listing_id)`: promedio del
  bien.
- `listing_landlord_ratings_landlord_id_idx` sobre `(landlord_id)`: promedio del
  arrendador.

Restricciones `CHECK`, escritas a mano al final de la migración:

| Nombre | Regla |
|---|---|
| `listing_landlord_ratings_listing_score_check` | El puntaje del bien va de 1 a 5. |
| `listing_landlord_ratings_landlord_score_check` | El puntaje del arrendador va de 1 a 5. |
| `listing_landlord_ratings_comment_check` | El comentario, si viene, debe tener algún carácter que no sea espacio en blanco (`~ '\S'`). |
| `listing_landlord_ratings_author_not_landlord_check` | El autor y el arrendador no pueden ser la misma persona. |

**Trigger `listing_landlord_ratings_consistency`** (función
`listing_landlord_ratings_consistency_check`): al insertar, o al cambiar
`reservation_id`, `author_id`, `listing_id` o `landlord_id`, exige que la
publicación sea la de la reserva, el autor quien reservó y el arrendador el
dueño de esa publicación. Si no, responde `check_violation` con el nombre de la
regla en el mensaje, igual que un `CHECK`. Si la reserva no existe, responde la
FK (`P2003`) y no el trigger.

Las tablas `users`, `listings` y `reservations` no cambian: las relaciones
inversas (`Reservation.listingLandlordRating`, `Listing.ratings`,
`User.listingRatingsWritten`, `User.listingRatingsReceived`) existen solo en el
cliente de Prisma.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `calificacion_bien_arrendador` (tabla) | `listing_landlord_ratings` | `ListingLandlordRating` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `autor_id` | `author_id` | `authorId` |
| `publicacion_id` | `listing_id` | `listingId` |
| `arrendador_id` | `landlord_id` | `landlordId` |
| `puntaje_bien` | `listing_score` | `listingScore` |
| `puntaje_arrendador` | `landlord_score` | `landlordScore` |
| `comentario` | `comment` | `comment` |
| `created_at` | `created_at` | `createdAt` |

### Promedios

Los dos promedios salen de esta tabla, sin columnas adicionales, y cada uno usa
su índice:

```sql
-- Promedio del bien (por publicación), con un decimal.
SELECT ROUND(AVG("listing_score")::numeric, 1)
FROM "listing_landlord_ratings"
WHERE "listing_id" = $1;

-- Promedio del arrendador (por arrendador), con un decimal.
SELECT ROUND(AVG("landlord_score")::numeric, 1)
FROM "listing_landlord_ratings"
WHERE "landlord_id" = $1;
```

Sin calificaciones, `AVG` devuelve `NULL` y el resultado es `NULL`: BE-17.1 lo
entrega como `null`. El promedio del arrendador junta las calificaciones de
todas sus publicaciones.

`ROUND` de PostgreSQL sobre `numeric` redondea la mitad hacia arriba (4.25
pasa a 4.3). Si BE-17.1 prefiere redondear en el servicio, `Math.round(x * 10)
/ 10` da lo mismo: lo comparé con `ROUND` en todos los promedios posibles de
hasta 2000 calificaciones de 1 a 5 (más de 8 millones de casos) y no hay
diferencias.

### Decisiones

- **`UNIQUE` en la reserva y no una consulta previa.** Si el arrendatario envía
  el formulario dos veces a la vez, las dos peticiones podrían leer "no hay
  calificación" antes de insertar. Con el índice único la segunda falla en la
  base, y BE-17.1 convierte ese error en el 409 "la reserva ya fue calificada".
  Hay prueba con dos inserciones simultáneas.
- **`RESTRICT` en las cuatro claves.** La calificación es parte del historial
  de la reserva, como el pago: no desaparece si se intenta borrar la reserva,
  la publicación o a alguna de las dos personas. Borrar ya lo frena también
  `reservations`, así que la regla de estas FK se comprueba en el catálogo.
- **`listing_id` y `landlord_id` repetidos en esta tabla.** Ya están en la
  reserva y en la publicación, pero tenerlos aquí deja promediar por
  publicación y por arrendador con un índice, sin unir tres tablas. BE-17.1 los
  copia de la reserva al guardar.
- **Trigger para que esas copias no se desvíen.** Una fila con otro
  `listing_id` o `landlord_id` contaría en el promedio equivocado. Cruza tablas
  (`reservations` y `listings`), por eso es un trigger y no un `CHECK`. Es la
  misma técnica que `conversations_reservation_participants` (DB-16.1). Solo
  vigila esta tabla: si después cambiara el dueño de una publicación o el
  arrendatario de una reserva, las calificaciones ya guardadas no se
  actualizan. Hoy ninguna historia hace esos cambios.
- **La base no revisa que la reserva esté `COMPLETADA`.** El estado cambia y la
  calificación ya hecha tiene que quedar; esa regla (422) y la de que solo el
  arrendatario de la reserva califica (404 y 403) las revisa BE-17.1. Lo que sí
  garantiza la base es el puntaje, el largo del comentario, que haya una sola
  calificación por reserva y que cuadren la publicación y las personas.
- **El largo del comentario lo da el tipo.** `VARCHAR(500)` cuenta caracteres,
  no bytes: 500 letras con tilde o `ñ` caben. BE-17.1 debe recortarlo con
  `trim()` y guardar `NULL` si queda vacío.
- **Sin `updated_at`.** Ninguna historia permite editar o borrar una
  calificación. La base tampoco lo impide: es una regla del servicio.

### Cómo revertir la migración

```sql
DROP TABLE "listing_landlord_ratings";
DROP FUNCTION "listing_landlord_ratings_consistency_check"();
```

`DROP TABLE` se lleva el trigger. No toca ninguna otra tabla, así que las
reservas quedan igual.

### Prueba de restricciones

[`test/listing-landlord-ratings.constraints.e2e-spec.ts`](../../test/listing-landlord-ratings.constraints.e2e-spec.ts)
(`npm run test:e2e`, contra la base `_test`): se guarda con su reserva, autor,
publicación y arrendador, con y sin comentario, y se lee desde cada uno; los
puntajes de 1 a 5 entran en los dos campos y 0, 6, -1 y 100 no; los dos
puntajes son independientes; una segunda calificación de la misma reserva se
rechaza, también cuando las dos llegan a la vez; comentario de 500 y de 501
caracteres, con `ñ`, vacío y de solo espacios; el trigger rechaza un autor, un
arrendador o una publicación que no son los de la reserva, al crear y al
cambiar cada columna por separado; una reserva inexistente (FK); nadie se
califica a sí mismo; el `RESTRICT` de las cuatro FK; los promedios por
publicación y por arrendador con un decimal y `NULL` sin calificaciones; y los
índices.

Quité por separado cada `CHECK`, el índice único, los dos índices de promedio,
el trigger, el trigger solo en `INSERT`, cada columna de su `UPDATE OF` y cada
FK pasada a `CASCADE`, en la base de pruebas: en los 18 casos la prueba falla.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```
