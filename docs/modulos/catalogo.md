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
| `POST` | `/api/v1/publicaciones` | Sí | `201 { id, tipo, nombre, activo }` |
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

### Pendiente

- **403 para quien no es arrendador.** Depende del guard de roles del Módulo 0
  (MP4-126). Por ahora cualquier usuario con sesión puede publicar; la prueba
  quedó como `it.todo` en `test/listings.e2e-spec.ts`.
