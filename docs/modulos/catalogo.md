# Módulo 1: Catálogo de publicaciones

Equipos y espacios que publica un arrendador (historia H01). El resto de
módulos se cuelga de aquí: búsqueda y filtros (H02, H11), detalle (H12),
reservas (H03) y verificación requerida (H19).

## DB-01.1. Entidades de publicaciones e imágenes (MP4-32)

### Modelo de datos

Migración
[`20261114205825_create_listings`](../../prisma/migrations/20261114205825_create_listings/migration.sql).

**Tabla `listings`** (modelo Prisma `Listing`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `landlord_id` | `UUID` | no | Arrendador dueño. FK a `users.id`, `ON DELETE RESTRICT`. |
| `type` | `ListingType` | no | `EQUIPO` o `ESPACIO`. |
| `name` | `VARCHAR(100)` | no | Nombre del bien. No puede estar en blanco. |
| `description` | `VARCHAR(1000)` | sí | Descripción libre. |
| `location` | `VARCHAR(200)` | no | Ubicación. No puede estar en blanco. |
| `rate_amount` | `DECIMAL(12,2)` | no | Tarifa. `CHECK (rate_amount > 0)`. |
| `rate_unit` | `RateUnit` | no | `HORA`, `DIA`, `NOCHE` o `SEMANA`. |
| `deposit_amount` | `DECIMAL(12,2)` | no | Depósito de garantía, `0` por defecto. `CHECK (deposit_amount >= 0)`. |
| `conditions` | `VARCHAR(1000)` | sí | Condiciones de uso. |
| `is_active` | `BOOLEAN` | no | `true` por defecto. El catálogo público solo muestra las activas. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

Índice `listings_landlord_id_idx` sobre `landlord_id`, para "mis publicaciones"
y para validar el dueño en H04, H14 y H19. Los índices de búsqueda y filtros
son de DB-02.1 y DB-11.1.

**Tabla `listing_images`** (modelo Prisma `ListingImage`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `listing_id` | `UUID` | no | FK a `listings.id`, `ON DELETE CASCADE`. |
| `path` | `TEXT` | no | Ruta privada en el almacenamiento o URL de la imagen. |
| `position` | `INTEGER` | no | Orden en que se muestra (0, 1, 2...). `CHECK (position >= 0)`. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de carga. |

Índice único `(listing_id, position)`: dos fotos de la misma publicación no
pueden ocupar la misma posición, y además sirve para leerlas en orden.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `publicacion` (tabla) | `listings` | `Listing` |
| `arrendador_id` | `landlord_id` | `landlordId` |
| `tipo` | `type` | `type` |
| `nombre` | `name` | `name` |
| `descripcion` | `description` | `description` |
| `ubicacion` | `location` | `location` |
| `tarifa_monto` | `rate_amount` | `rateAmount` |
| `tarifa_unidad` | `rate_unit` | `rateUnit` |
| `deposito_monto` | `deposit_amount` | `depositAmount` |
| `condiciones` | `conditions` | `conditions` |
| `activo` | `is_active` | `isActive` |
| `imagen_publicacion` (tabla) | `listing_images` | `ListingImage` |
| `ruta_privada_o_url` | `path` | `path` |
| `orden` | `position` | `position` |

Los valores de los enums se quedan en español (`EQUIPO`, `DIA`...) porque son
los mismos que viajan en la API (`tipo`, `tarifaUnidad` en BE-01.1).

### Decisiones

- **`RESTRICT` en el arrendador, `CASCADE` en las imágenes.** Una publicación
  va a tener reservas y pagos colgando, así que no debe desaparecer si se borra
  el usuario. Las imágenes, en cambio, no tienen sentido sin su publicación.
- **Los `CHECK` van a mano en la migración.** Prisma no modela restricciones
  `CHECK`; se agregaron al final del `migration.sql` con nombre propio para que
  el error diga qué regla se rompió.
- **Lo que no se valida en la base.** El mínimo de 1 y el máximo de 10 fotos,
  el tipo (JPG/PNG) y el tamaño (5 MB) se validan en BE-01.1 al recibir el
  `multipart/form-data`; la base no ve los archivos.
- **No se toca `users`.** La tabla de la cátedra queda igual; el rol de
  arrendador se valida en el backend (Módulo 0, MP4-124).

### Prueba de restricciones

[`test/listings.constraints.e2e-spec.ts`](../../test/listings.constraints.e2e-spec.ts)
comprueba los valores por defecto, el redondeo a dos decimales, los `CHECK`
(tarifa, depósito, nombre y ubicación en blanco, posición), el largo del
nombre, los enums, las dos FK, el orden de las imágenes, la posición única y
el comportamiento al borrar.

Corre contra la misma base de pruebas que la de notificaciones:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```

## BE-01.1. Registro y consulta de publicaciones (MP4-33)

### Endpoints

| Método | Ruta | Sesión | Respuesta |
|---|---|---|---|
| `POST` | `/api/v1/publicaciones` | Sí, rol `ARRENDADOR` | `201 { id, tipo, nombre, activo }` |
| `GET` | `/api/v1/publicaciones/{id}` | No | `200` con la publicación y sus imágenes en orden |
| `GET` | `/api/v1/publicaciones/{id}/imagenes/{orden}` | No | `200` con la foto (`image/jpeg` o `image/png`) |

El `POST` recibe `multipart/form-data` con `tipo`, `nombre`, `descripcion`,
`ubicacion`, `tarifaMonto`, `tarifaUnidad`, `depositoMonto`, `condiciones` y
las fotos en `imagenes` (también se acepta `imagenes[]`, que es como lo manda
un `FormData` del frontend).

### Validaciones

- Campos: las de la tabla de DB-01.1, con mensajes en español para mostrarlos
  tal cual en el formulario.
- Fotos: de 1 a 10, JPG o PNG, máximo 5 MB cada una. El tipo se revisa por la
  firma del archivo, no por la extensión ni por el `Content-Type`, así que un
  PDF renombrado a `.jpg` se rechaza.
- Todo error de datos o de archivos responde **400** y no deja nada guardado:
  si el insert falla después de escribir fotos, se borran.
- Una publicación desactivada responde **404**, igual que una que no existe.

### Dónde quedan las fotos

En la carpeta `UPLOADS_DIR` (por defecto `./uploads`, fuera de git), con
nombre aleatorio: `listings/<uuid>.jpg`. En la base solo se guarda esa ruta
relativa; la API nunca expone rutas del servidor.

En Docker, `UPLOADS_DIR` es `/app/uploads`. El Dockerfile crea esa carpeta con
dueño `node` (el contenedor no corre como root) y `docker-compose.yml` monta
ahí el volumen `uploads`, para que las fotos sobrevivan cuando se recrea el
contenedor. En la demo desplegada hay que montar un volumen o disco
persistente en la misma ruta.

### Permisos

El `POST` lleva `@Roles('ARRENDADOR')` (Módulo 0, MP4-126): sin sesión
responde 401 y con una cuenta de arrendatario o revisor responde 403.

## DB-02.1. Índices para la búsqueda por palabra clave (MP4-40)

Migración
[`20261120051614_add_listing_search_indexes`](../../prisma/migrations/20261120051614_add_listing_search_indexes/migration.sql).
No agrega tablas ni columnas: la búsqueda lee `name` y `description` tal como
están, sin copias normalizadas.

| Objeto | Qué es | Para qué |
|---|---|---|
| `unaccent`, `pg_trgm` | Extensiones de PostgreSQL | Quitar acentos y permitir que un `LIKE '%texto%'` use índice. |
| `search_text(texto)` | Función `IMMUTABLE` que devuelve `unaccent(lower(texto))` | Es la expresión de búsqueda. Los índices se crean sobre ella y las consultas deben usarla. |
| `listings_name_search_idx` | GIN (`gin_trgm_ops`) sobre `search_text(name)` | Buscar en el nombre sin distinguir mayúsculas ni acentos. |
| `listings_description_search_idx` | GIN (`gin_trgm_ops`) sobre `search_text(description)` | Lo mismo en la descripción. |
| `listings_is_active_created_at_id_idx` | B-tree `(is_active, created_at DESC, id DESC)` | Orden por defecto del catálogo: activas, más reciente primero. |

### Cómo se consulta

```sql
SELECT id, name FROM listings
WHERE is_active
  AND (search_text(name) LIKE '%' || search_text(:texto) || '%'
    OR search_text(description) LIKE '%' || search_text(:texto) || '%')
ORDER BY created_at DESC, id DESC;
```

### Decisiones

- **Función `search_text` en vez de `unaccent(lower(...))` directo.**
  `unaccent()` es `STABLE` y PostgreSQL solo acepta funciones `IMMUTABLE` en un
  índice. La función fija esa expresión y la declara `IMMUTABLE`; por dentro
  llama a `public.unaccent` con el esquema escrito, porque PostgreSQL construye
  los índices con un `search_path` restringido. Supone que las extensiones
  están en `public`, que es el esquema que usa el proyecto.
- **Los índices GIN solo existen en la migración.** Prisma no modela índices
  sobre expresiones; el B-tree del orden sí está en `schema.prisma`.
- **Crear las extensiones pide permisos.** `CREATE EXTENSION` necesita un
  usuario dueño de la base o superusuario. Con el `postgres` de Docker funciona;
  en un proveedor administrado hay que confirmar que permita `unaccent` y
  `pg_trgm`.
- **Menos de 3 letras no usa el índice.** Los trigramas necesitan al menos tres
  caracteres; con textos más cortos la búsqueda funciona igual pero recorre la
  tabla.

### Prueba

[`test/listings.search.constraints.e2e-spec.ts`](../../test/listings.search.constraints.e2e-spec.ts)
comprueba que existen las extensiones y los tres índices, que la búsqueda
ignora mayúsculas y acentos en nombre y descripción, que no falla sin
registros, que excluye las inactivas, el orden por defecto y que el
planificador puede usar los índices.

## BE-02.1. Listado público con búsqueda y paginación (MP4-41)

### Endpoint

| Método | Ruta | Sesión | Respuesta |
|---|---|---|---|
| `GET` | `/api/v1/publicaciones?buscar=taladro&page=1&limit=12` | No | `200 { items, page, total }` |

| Parámetro | Por defecto | Regla |
|---|---|---|
| `buscar` | (vacío) | Texto de hasta 100 caracteres. Vacío o ausente devuelve todas las activas. |
| `page` | `1` | Entero de 1 a 10 000. |
| `limit` | `12` | Entero de 1 a 50. |

```json
{
  "items": [
    {
      "id": "7c1e...",
      "nombre": "Taladro percutor",
      "precio": 15,
      "tipo": "EQUIPO",
      "tarifaUnidad": "DIA",
      "ubicacion": "Antiguo Cuscatlán",
      "imagenUrl": "/api/v1/publicaciones/7c1e.../imagenes/0"
    }
  ],
  "page": 1,
  "total": 1
}
```

### Reglas

- Solo publicaciones activas (`is_active = true`), siempre.
- Coincide si el nombre **o** la descripción contienen el texto, sin
  distinguir mayúsculas ni acentos: `salon` encuentra `Salón`. Usa
  `search_text`, la misma expresión de los índices de DB-02.1.
- Orden: `created_at DESC, id DESC` (más reciente primero).
- `total` cuenta todas las coincidencias, no solo las de la página. Una página
  más allá del final responde `200` con `items: []`.
- `%` y `_` escritos por el usuario se buscan como texto, no como comodines.
- **400** si `page` o `limit` no son enteros o salen de rango, si `buscar`
  pasa de 100 caracteres o si llega un parámetro que no existe.

### Decisiones

- **`id` es UUID.** La ficha muestra `17` como ejemplo, pero las publicaciones
  usan UUID desde DB-01.1.
- **`precio` es un número** (`15`, `15.5`), como pide la ficha. Es la tarifa
  por unidad; el detalle (`GET /publicaciones/{id}`) la sigue dando como
  `tarifaMonto` en texto.
- **Tres campos más que la ficha: `tarifaUnidad`, `ubicacion` e `imagenUrl`.**
  FE-02.1 debe mostrar ubicación, tarifa y fotografía principal en cada
  tarjeta; sin ellos haría una consulta de detalle por tarjeta. `imagenUrl` es
  `null` si la publicación no tiene fotos.
- **La consulta va en SQL (`$queryRaw`).** Prisma no puede llamar a
  `search_text` desde un `where`. Los valores van como parámetros.
- **Los filtros de BE-11.1** (tipo, ubicación, precio y fechas) van en el
  mismo endpoint; ver la sección BE-11.1.

### Pruebas

[`test/listings.search.e2e-spec.ts`](../../test/listings.search.e2e-spec.ts):
forma de la respuesta, búsqueda en nombre y descripción con y sin acentos,
inactivas, cero resultados, orden, paginación, 12 por defecto, comodines y
los 400.

## DB-11.1. Índices para los filtros del catálogo (MP4-44)

Migración
[`20261120084714_add_listing_filter_indexes`](../../prisma/migrations/20261120084714_add_listing_filter_indexes/migration.sql).
No agrega tablas ni columnas.

| Índice | Columnas | Filtro que sostiene |
|---|---|---|
| `listings_is_active_type_rate_amount_idx` | B-tree `(is_active, type, rate_amount)` | Tipo (`EQUIPO` o `ESPACIO`) y rango de tarifa sobre las activas. |
| `listings_location_search_idx` | GIN (`gin_trgm_ops`) sobre `search_text(location)` | Ubicación que contiene el texto, sin distinguir mayúsculas ni acentos. |

### Decisiones

- **El filtro por fechas disponibles no agrega índices.** Una publicación está
  disponible en un rango si `listing_busy_periods` (DB-13.1) no devuelve
  ningún período ocupado; esa función ya usa los índices de `reservations`
  (DB-03.1) y de `availability_blocks` (DB-14.1).
- **La ubicación reutiliza `search_text` y `pg_trgm` de DB-02.1**, así
  `san salvador` encuentra `San Salvador` y `cuscatlan` encuentra `Cuscatlán`.
- **El B-tree empieza por `is_active`**, porque el catálogo público siempre
  filtra las activas. Un rango de tarifa sin tipo no lo aprovecha completo;
  con el volumen del proyecto no hace falta otro índice.
- El B-tree está en `schema.prisma`; el GIN solo en la migración.

### Prueba

En [`test/listings.search.constraints.e2e-spec.ts`](../../test/listings.search.constraints.e2e-spec.ts):
que existen los dos índices y que el planificador puede usarlos para filtrar
por tipo con tarifa y por ubicación.

## BE-11.1. Filtros del listado público (MP4-45)

Mismo endpoint de BE-02.1, `GET /api/v1/publicaciones`, con filtros
opcionales. Se combinan entre sí y con `buscar`: una publicación debe
cumplirlos todos. La respuesta, el orden y la paginación no cambian.

| Parámetro | Regla |
|---|---|
| `tipo` | `EQUIPO` o `ESPACIO`. |
| `ubicacion` | La ubicación contiene el texto, sin distinguir mayúsculas ni acentos. Hasta 200 caracteres. |
| `precioMin` | Tarifa mayor o igual. Número de 0 en adelante, con hasta dos decimales. |
| `precioMax` | Tarifa menor o igual. No puede ser menor que `precioMin`. |
| `fechaInicio`, `fechaFin` | Días `AAAA-MM-DD` en hora de El Salvador, los dos incluidos. Van juntos y `fechaInicio` no puede ser un día pasado. Devuelve solo las publicaciones libres en todo el rango. |

Ejemplo:
`GET /api/v1/publicaciones?tipo=ESPACIO&ubicacion=san salvador&precioMax=60&fechaInicio=2026-12-01&fechaFin=2026-12-03`

### Reglas

- **Disponible** significa que en el rango no hay reservas `CONFIRMADA` o
  `EN_CURSO` ni bloqueos del arrendador. Las solicitudes `PENDIENTE` no
  apartan fechas. Es la misma regla del calendario (H13), porque usa la misma
  función `listing_busy_periods`.
- Los períodos son semiabiertos: una reserva que termina justo cuando empieza
  el rango no lo ocupa.
- El precio compara la tarifa tal como está publicada, sin convertir entre
  unidades (hora, día, noche, semana).
- Con filtros que no dejan resultados responde `200` con `items: []`.
- **400** si `tipo` no es del enum, un precio es negativo, no es número o
  tiene más de dos decimales, `precioMin` supera a `precioMax`, llega solo una
  de las dos fechas, una fecha no existe o tiene otro formato, `fechaFin` es
  anterior a `fechaInicio` o `fechaInicio` ya pasó.

### Decisiones

- **Mismo formato y zona horaria que el calendario**
  (`GET /publicaciones/{id}/disponibilidad`): días `AAAA-MM-DD` de El
  Salvador. Los nombres son los de la ficha, `fechaInicio` y `fechaFin`.
- **"En el pasado" se mide por día de El Salvador.** Hoy es válido como
  `fechaInicio`; ayer no.
- **Sin tope de días en el rango**, a diferencia del calendario: aquí no se
  devuelven los períodos, solo se pregunta si hay alguno.
- La conversión de fechas reutiliza `startOfLocalDay` del módulo de
  disponibilidad, importado por ruta directa para no crear un ciclo entre los
  dos módulos.

### Pruebas

[`test/listings.filters.e2e-spec.ts`](../../test/listings.filters.e2e-spec.ts)
(29 pruebas): cada filtro por separado, combinados, con paginación, inactivas,
fechas disponibles con reservas en cada estado y bloqueos, los extremos del
rango y los 400.

## DB-12.1. Consultas del detalle de publicación (MP4-36)

El detalle completo (H12) muestra la publicación con sus fotos en orden y los
promedios de calificaciones. Esta task deja verificado que la base ya responde
esas consultas rápido. **No agrega migración**: los índices que hacen falta ya
existen.

| Qué pide el detalle | Con qué se resuelve | De dónde viene |
|---|---|---|
| Fotos en orden | Índice único `listing_images_listing_id_position_key` sobre `(listing_id, position)`. Entrega las fotos ya ordenadas, sin ordenar aparte. | DB-01.1 |
| Promedio del bien | `listing_landlord_ratings_listing_id_idx` sobre `(listing_id)` | DB-17.1 |
| Promedio del arrendador | `listing_landlord_ratings_landlord_id_idx` sobre `(landlord_id)` | DB-17.1 |
| Excluir desactivadas | Clave primaria `listings_pkey` sobre `(id)` y el filtro `is_active` en esa misma fila | DB-01.1 |

### La consulta

```sql
SELECT
  l.*,
  (SELECT ROUND(AVG(r.listing_score)::numeric, 1)
     FROM listing_landlord_ratings r
    WHERE r.listing_id = l.id)           AS promedio_bien,
  (SELECT ROUND(AVG(r.landlord_score)::numeric, 1)
     FROM listing_landlord_ratings r
    WHERE r.landlord_id = l.landlord_id) AS promedio_arrendador,
  (SELECT COUNT(*)
     FROM listing_landlord_ratings r
    WHERE r.listing_id = l.id)           AS total_calificaciones
FROM listings l
WHERE l.id = :id AND l.is_active;

SELECT position, path FROM listing_images
WHERE listing_id = :id ORDER BY position;
```

- El promedio del bien es de esa publicación; el del arrendador junta las
  calificaciones de **todas** sus publicaciones.
- Sin calificaciones, `AVG` devuelve `NULL` y el total es `0`.
- Una publicación desactivada o que no existe no devuelve fila.

### Decisiones

- **Sin índice `(id, is_active)`.** La ficha pide verificarlo. `id` es la clave
  primaria, así que la búsqueda ya llega a una sola fila y `is_active` se
  revisa ahí mismo; un índice compuesto no ahorraría nada.
- **Sin índice nuevo para las fotos.** El `(listing_id, position)` que pide la
  ficha ya existe desde DB-01.1 como índice único.
- **Los promedios no se guardan.** Se calculan de `listing_landlord_ratings`
  cada vez, sin columnas en `listings` ni en `users`, como define DB-17.1
  ([resenas](resenas.md)). La regla de redondeo es la de esa sección.

### Prueba

[`test/listings.detail.constraints.e2e-spec.ts`](../../test/listings.detail.constraints.e2e-spec.ts)
(9 pruebas): fotos en orden y uso del índice sin ordenar aparte, promedios
con un decimal por publicación y por arrendador, `NULL` sin calificaciones,
que una calificación nueva no toca la publicación, que no hay columnas de
promedio guardadas, uso de los dos índices de calificaciones y exclusión de
las desactivadas por la clave primaria.

## BE-12.1. Detalle completo de la publicación (MP4-37)

Amplía `GET /api/v1/publicaciones/{id}` (BE-01.1) con todo lo que el
arrendatario necesita antes de reservar (H12). Sigue siendo pública.

```json
{
  "id": "7c1e...",
  "tipo": "EQUIPO",
  "nombre": "Taladro",
  "descripcion": "Percutor de 800 W",
  "ubicacion": "San Salvador",
  "tarifa": { "monto": 15, "unidad": "HORA" },
  "deposito": 20,
  "condiciones": "Devolver limpio",
  "imagenes": [{ "orden": 0, "url": "/api/v1/publicaciones/7c1e.../imagenes/0" }],
  "promedioBien": 4.5,
  "promedioArrendador": 4.8,
  "totalCalificaciones": 6,
  "requiereVerificacion": false
}
```

Además conserva los campos de BE-01.1: `activo`, `arrendadorId`,
`tarifaMonto`, `tarifaUnidad`, `depositoMonto` y `createdAt`.

### Reglas

- Las fotos salen en orden (`orden` 0, 1, 2...).
- `promedioBien` es el de esa publicación; `promedioArrendador` junta las
  calificaciones de todas las publicaciones del dueño. Los dos con un decimal.
- `totalCalificaciones` cuenta las de esa publicación.
- **Sin calificaciones:** los promedios son `null` y el total es `0`.
- **Desactivada o inexistente:** `404` con `codigo:
  "PUBLICACION_NO_DISPONIBLE"`. La respuesta es idéntica en los dos casos.
- Un `id` que no es UUID es `400`.
- Del arrendador solo sale su `id`: ni nombre, ni correo, ni teléfono.

### Decisiones

- **Se amplía sin quitar nada.** La ficha muestra `tarifa { monto, unidad }` y
  `deposito`; se agregan como número, pero `tarifaMonto`, `tarifaUnidad` y
  `depositoMonto` se quedan porque el frontend ya los usa (detalle de FE-01.1,
  pagos y mensajería). Se pueden retirar cuando nadie los lea.
- **`requiereVerificacion`** no está en la ficha. Lo pidió Ricardo en MP4-37
  para FE-19.1: el interruptor del dueño y la insignia del detalle necesitan
  leer el valor, y solo existía el `PATCH` para cambiarlo.
- **Los promedios vienen de BE-17.1**
  (`ListingRatingsService.promedioCalificaciones`), para que la regla de
  redondeo sea una sola. El total lo cuenta `ListingRepository.countRatings`.
- **`id` es UUID** y `orden` empieza en 0, como en BE-01.1; la ficha usa `17`
  y `1` como ejemplo.
- **El `codigo` va en todo 404 de publicación**, porque sale de
  `ListingsService.findById`: también lo reciben la disponibilidad y los
  demás endpoints que cuelgan de una publicación.

### Pruebas

[`test/listings.detail.e2e-spec.ts`](../../test/listings.detail.e2e-spec.ts)
(11 pruebas): el detalle completo sin sesión, fotos en orden, promedios por
publicación y por arrendador, sin calificaciones, una calificación nueva, que
no salen datos privados, los dos 404 con su `codigo` e idénticos, el 400 y el
cambio al desactivar.
