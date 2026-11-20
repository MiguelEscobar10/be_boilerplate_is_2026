# Módulo 8: Notificaciones

Avisos informativos asociados a un usuario (historia H10). Los registra el
servicio de avisos (H20) y se consultan desde la bandeja de cada usuario.
Contrato del servicio de avisos para los módulos emisores: [`docs/contratos/servicio-avisos.md`](../contratos/servicio-avisos.md).

## DB-10.1. Entidad de notificaciones por usuario (MP4-106)

### Modelo de datos

Tabla `notifications` (modelo Prisma `Notification`), migración
[`20261114191557_create_notifications`](../../prisma/migrations/20261114191557_create_notifications/migration.sql).

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `user_id` | `UUID` | no | Destinatario. FK a `users.id`, `ON DELETE CASCADE`. |
| `source_module` | `"ModuloOrigen"` | no | Módulo que originó el aviso. Enum desde DB-20.1. |
| `title` | `TEXT` | no | Título del aviso. |
| `message` | `TEXT` | no | Texto del aviso. Sin datos sensibles. |
| `reference_type` | `TEXT` | sí | Tipo de la entidad referida (p. ej. `reserva`). |
| `reference_id` | `TEXT` | sí | Identificador de la entidad referida. |
| `read_at` | `TIMESTAMP(3)` | sí | Fecha de lectura. `NULL` = pendiente. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación, `DEFAULT CURRENT_TIMESTAMP`. |

Índice `notifications_user_id_read_at_created_at_idx` sobre
`(user_id, read_at, created_at DESC)`: cubre la bandeja de pendientes
(`WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC`) y la de
recientes (`WHERE user_id = ? ORDER BY created_at DESC`).

La tabla `users` no cambia: la relación inversa `User.notifications` existe
solo en el cliente de Prisma.

### Equivalencias con el brief

El brief usa nombres en español; el repositorio usa inglés en `snake_case`
(como `users` y `refresh_tokens`), tablas en plural y claves `uuid`.

| Brief (`notificacion`) | Columna en la base | Campo en Prisma |
|---|---|---|
| `notificacion` (tabla) | `notifications` | `Notification` |
| `id` | `id` | `id` |
| `usuario_id` | `user_id` | `userId` |
| `modulo_origen` | `source_module` | `sourceModule` |
| `titulo` | `title` | `title` |
| `mensaje` | `message` | `message` |
| `referencia_tipo` | `reference_type` | `referenceType` |
| `referencia_id` | `reference_id` | `referenceId` |
| `leida_at` | `read_at` | `readAt` |
| `created_at` | `created_at` | `createdAt` |

### Decisiones

- **Nombres en inglés.** Siguen el estilo del esquema existente. La tabla de
  arriba relaciona cada nombre del brief con su columna.
- **`source_module` empezó como `TEXT NOT NULL`.** El enum `ModuloOrigen`, los
  límites de `title` y `message` y el índice único parcial se agregaron en
  DB-20.1 (ver la sección siguiente).
- **`reference_id` es `TEXT`, no `UUID`.** La referencia puede apuntar a
  entidades de cualquier módulo, así que no se ata al tipo de clave de ninguno.
- **`ON DELETE CASCADE` y sin `updated_at`.** Igual que `refresh_tokens`: los
  avisos no tienen sentido sin su destinatario. Lo único que cambia después de
  crear un aviso es `read_at`, que ya guarda cuándo se leyó.
- **Sin datos sensibles en `title` ni `message`.** Nunca números de tarjeta,
  códigos de seguridad ni contraseñas. La base no puede verificarlo; lo
  garantiza el servicio de avisos (BE-20.1) y quien lo llama.

## DB-20.1. Enum de módulos de origen y restricciones (MP4-111)

Migración
[`20261115074205_notifications_source_module_enum_and_constraints`](../../prisma/migrations/20261115074205_notifications_source_module_enum_and_constraints/migration.sql),
escrita a mano a partir de `prisma migrate dev --create-only`.

### Enum `ModuloOrigen`

Un valor por módulo del proyecto. Es el tipo de `notifications.source_module`.

| Valor | Módulo |
|---|---|
| `CATALOGO` | Catálogo de equipos y espacios |
| `BUSQUEDA` | Búsqueda |
| `RESERVAS` | Reservas |
| `PAGOS_GARANTIA` | Pagos y garantía |
| `MENSAJERIA` | Mensajería |
| `RESENAS` | Reseñas |
| `VERIFICACION` | Verificación |
| `NOTIFICACIONES` | Notificaciones |
| `REPORTES` | Reportes |

Agregar un módulo es una migración nueva con
`ALTER TYPE "ModuloOrigen" ADD VALUE '...'`.

### Restricciones

| Nombre | Regla | Error de Postgres |
|---|---|---|
| `notifications_title_length_check` | `char_length(btrim(title)) >= 1 AND char_length(title) <= 100` | 23514 |
| `notifications_message_length_check` | `char_length(btrim(message)) >= 1 AND char_length(message) <= 500` | 23514 |
| `notifications_reference_pair_check` | `(reference_type IS NULL) = (reference_id IS NULL)` | 23514 |
| `notifications_dedupe_key` | Índice único sobre `(user_id, source_module, reference_type, reference_id, title)` `WHERE reference_id IS NOT NULL` | 23505 (Prisma `P2002`) |

Un `source_module` fuera del enum lo rechaza el tipo: error 22P02
(`invalid input value for enum "ModuloOrigen"`).

### Decisiones

- **Conversión en el lugar.** Para el cambio de tipo, Prisma generaba
  `DROP COLUMN` + `ADD COLUMN`, que borra los datos. La migración usa
  `ALTER COLUMN "source_module" TYPE "ModuloOrigen" USING "source_module"::"ModuloOrigen"`.
  Si alguna fila tuviera un valor fuera del enum, la migración falla en vez de
  alterar datos.
- **CHECK en vez de `VARCHAR(n)`.** `VARCHAR` solo pone el máximo y daría otro
  código de error (22001). Con CHECK, el mínimo y el máximo viven en un solo
  lugar y el nombre de la restricción dice cuál falló. `char_length` cuenta
  caracteres, no bytes.
- **Mínimo sin espacios, máximo con espacios.** El mínimo se mide con `btrim`
  (sin los espacios de los extremos), así que `'   '` cuenta como vacío y se
  rechaza. El máximo se mide sobre el texto completo: si también usara `btrim`,
  un título `'a'` seguido de 200 espacios pasaría y quedaría guardado con 201
  caracteres.
- **Referencia completa o ninguna.** Un tipo sin id (o un id sin tipo) no
  identifica nada. Además, como Postgres trata los `NULL` como distintos en un
  índice único, una referencia con `reference_type` en `NULL` dejaría pasar
  duplicados. El CHECK cierra ese hueco sin necesitar `NULLS NOT DISTINCT`.
- **Índice parcial.** Solo deduplica los avisos con referencia. Los avisos sin
  referencia (p. ej. "Mensaje nuevo") pueden repetirse. El `message` no es
  parte de la clave: el mismo aviso con otro texto sigue siendo un duplicado.
- **CHECK e índice solo en SQL.** `schema.prisma` lo indica con comentarios en
  el modelo.

### Drift con Prisma

Los CHECK y el índice parcial no están declarados en `schema.prisma`. Con
Prisma 7.10.0 (la versión instalada) no hay drift:

- `prisma migrate dev --create-only` sin cambios en el esquema genera una
  migración vacía. No propone `DROP INDEX` ni borra los CHECK.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  también da una migración vacía.

Prisma 7.10.0 trae el preview feature `partialIndexes`, que permitiría declarar
el índice con `@@unique([...], where: raw("reference_id IS NOT NULL"))`. No se
habilitó porque no hace falta para evitar drift y agrega una preview feature
al cliente compartido. Si una versión futura de Prisma empezara a proponer
`DROP INDEX "notifications_dedupe_key"` en una migración, hay que borrar esa
línea de la migración generada o declarar el índice con esa preview feature.

## Prueba de restricciones

[`test/notifications.constraints.e2e-spec.ts`](../../test/notifications.constraints.e2e-spec.ts)
comprueba la FK, los `NOT NULL`, el borrado en cascada, las consultas de
pendientes y recientes y que esas consultas usan el índice (DB-10.1). También
el enum, los límites de largo (incluidos texto de solo espacios y espacios de
relleno que pasan el máximo), el CHECK de la
referencia y el índice contra duplicados (DB-20.1).

Corre contra una **base de pruebas separada**, nunca contra la de desarrollo:
`TEST_DATABASE_URL` o, si no está, `DATABASE_URL` con `_test` agregado al
nombre de la base. Se niega a correr si la base no es local o su nombre no
termina en `_test`, y al terminar borra solo los usuarios que creó.

```bash
# Una vez: crear la base de pruebas y aplicarle las migraciones
docker compose exec postgres psql -U postgres -c "CREATE DATABASE si_be_boilerplate_test"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy

# Correr la prueba (está en la suite e2e porque necesita Postgres)
npm run test:e2e
```

Aplicar las migraciones sobre esa base vacía también sirve para validar que la
migración funciona en una base limpia, sin `prisma migrate reset` sobre la base
de desarrollo.

## BE-20.1. Servicio de avisos (MP4-112)

Servicio interno que registra avisos para los demás módulos del backend
(historia H20). **No es un endpoint público:** no tiene ruta (el único
controller del módulo es el de la bandeja, de BE-10.1, y no tiene `POST`).
El contrato publicado para el equipo, con ejemplos por módulo emisor, queda
para BE-20.2 (`docs/contratos/servicio-avisos.md`).

### Dónde vive y cómo se usa

```
src/notifications/
  notifications.module.ts      exporta AvisosService
  services/avisos.service.ts   notificar(aviso)
  repositories/notification.repository.ts
  errors/                      AvisoInvalidoError (+ errores internos del repositorio)
  types/aviso.types.ts         Aviso, ReferenciaAviso, AvisoRegistrado, CampoAviso, ModuloOrigen
```

Alias `@Notifications` y `@Notifications/*`. Un módulo que necesita avisar
importa `NotificationsModule` e inyecta `AvisosService`:

```ts
@Module({ imports: [NotificationsModule] /* ... */ })
export class ReservasModule {}

// en un servicio de ese módulo
await this.avisos.notificar({
  destinatarioId: reserva.arrendadorId,
  titulo: 'Nueva solicitud de reserva',
  mensaje: `Recibiste una solicitud de reserva para ${bien.nombre}.`,
  moduloOrigen: ModuloOrigen.RESERVAS,
  referencia: { tipo: 'reserva', id: reserva.id },
});
```

### Contrato

`notificar(aviso: Aviso): Promise<{ id: string }>`

| Campo | Obligatorio | Regla |
|---|---|---|
| `destinatarioId` | sí | UUID de un usuario existente. |
| `titulo` | sí | 1 a 100 caracteres después de recortar. |
| `mensaje` | sí | 1 a 500 caracteres después de recortar. |
| `moduloOrigen` | sí | Valor del enum `ModuloOrigen`. |
| `referencia` | no | `{ tipo, id }`, los dos strings no vacíos. `undefined` o `null` = sin referencia. |

Devuelve el `id` del aviso registrado, que queda como no leído
(`read_at = NULL`). Si el aviso ya existía (ver *Duplicados*), devuelve el id
del existente.

### Errores

Si el aviso no cumple el contrato lanza `AvisoInvalidoError` y **no registra
nada**:

```ts
error.codigo  // 'AVISO_INVALIDO'
error.campo   // el campo con error
error.message // explicación en español
```

Se valida en el orden de la tabla y se reporta el primer campo con error.

| `campo` | Cuándo |
|---|---|
| `destinatarioId` | Falta, no es string, no es UUID o el usuario no existe. |
| `titulo` | Falta, no es string, queda vacío al recortar o pasa de 100. |
| `mensaje` | Falta, no es string, queda vacío al recortar o pasa de 500. |
| `moduloOrigen` | Falta o no está en `ModuloOrigen`. |
| `referencia` | Viene pero no es un objeto. |
| `referencia.tipo` / `referencia.id` | La referencia viene sin uno de los dos. |

Es un error interno, no una excepción HTTP: cada módulo que llama decide qué
hacer con él. Cualquier otro error (p. ej. la base caída) se propaga tal cual.

### Decisiones

- **Se guardan recortados.** Título, mensaje y referencia se guardan sin los
  espacios de los extremos, y los largos se miden sobre el texto recortado.
  Así `'Pago aprobado '` y `'Pago aprobado'` son el mismo aviso al deduplicar.
- **El servicio repite los CHECK de DB-20.1** para dar un error claro con el
  campo antes de llegar a la base. Es algo más estricto: `trim()` también quita
  tabs y saltos de línea, mientras que `btrim` solo quita espacios. Los largos
  se cuentan por caracteres (`Array.from`), igual que `char_length`; con
  `.length` un emoji contaría como 2.
- **El módulo de origen se valida en tiempo de ejecución.** El tipo
  `ModuloOrigen` no protege a quien llama con un string cualquiera; sin esta
  validación el error sería el 22P02 de Postgres.
- **El destinatario lo valida la FK.** El servicio solo revisa que sea un UUID
  (si no, Postgres daría un error de tipo). Que exista lo decide la FK a
  `users`: el repositorio traduce el `P2003` y el servicio lanza
  `AvisoInvalidoError` con `campo: 'destinatarioId'`. Consultar antes tendría
  una carrera entre la lectura y el insert, y ataría este módulo a `UsersModule`.

### Duplicados

Si ya existe un aviso con el mismo destinatario, módulo, referencia y título,
no se crea otro y se devuelve el id del existente. Avisar dos veces por el
mismo evento es idempotente y quien llama no tiene que manejar nada. El
`mensaje` no es parte de la clave.

- **Se inserta sin consultar antes.** Si choca con el índice
  `notifications_dedupe_key` (Prisma `P2002`), el servicio busca el aviso que
  ocupa esa clave y devuelve su id. Con dos llamadas simultáneas, una inserta y
  la otra cae en `P2002` y recupera el id de la primera.
- **Cualquier `P2002` es un duplicado.** Fuera de la clave primaria (un uuid
  generado), la única restricción única de `notifications` es
  `notifications_dedupe_key`. No se lee `meta.target`, cuya forma cambia con el
  driver adapter. Si no se encuentra el existente, se relanza el error.
- **Sin referencia no se deduplica**, igual que el índice parcial: dos
  "Mensaje nuevo" seguidos son dos avisos.
- **Descartado:** `createManyAndReturn` con `skipDuplicates`
  (`ON CONFLICT DO NOTHING`). Evita la excepción, pero ocultaría también
  cualquier otra violación de unicidad y se aparta del patrón de
  `UserRepository`.

### Datos sensibles

`titulo` y `mensaje` **nunca** deben incluir números de tarjeta, códigos de
seguridad, números de documentos (DUI, NIT, pasaporte) ni contraseñas. **Los
importes sí se permiten:** H05 pide el monto total en el aviso de pago.

El servicio no lo valida: no hay una regla automática que distinga un número
de documento de un dato legítimo sin rechazar avisos válidos. Lo garantiza
quien llama, y la regla está en el JSDoc de `notificar` y del tipo `Aviso`.

### Swagger y permisos

El servicio de avisos no tiene ruta, así que no hay nada suyo que documentar en
Swagger. El criterio de permisos se cumple porque no se puede llamar desde
afuera: la prueba e2e verifica que `POST /api/v1/notificaciones` y
`POST /api/v1/avisos` responden 404.

Desde BE-10.1 el módulo sí tiene un controller, pero solo para la bandeja
(GET y PATCH, ver la sección siguiente). No hay `POST`, así que esa prueba
sigue pasando: Express responde 404 a un método sin ruta antes de llegar al
guard de JWT.

### Pruebas

- **Unitarias**
  ([`src/notifications/services/avisos.service.spec.ts`](../../src/notifications/services/avisos.service.spec.ts),
  `npm test`): validaciones, recorte, conteo de caracteres, traducción de
  errores del repositorio y duplicados, con el repositorio simulado. En cada
  caso de error verifican que no se llamó a la base.
- **E2e**
  ([`test/notifications.avisos.e2e-spec.ts`](../../test/notifications.avisos.e2e-spec.ts),
  `npm run test:e2e`): el servicio real contra la base `_test`. Aviso válido
  (no leído), sin referencia, sin destinatario, sin título, módulo inválido,
  destinatario inexistente, referencia incompleta, duplicado, cinco llamadas
  simultáneas que dejan un solo aviso, y el 404 de las rutas. En cada caso de
  error comprueban con `count` que no se registró nada.

Usa la misma base de pruebas que la prueba de restricciones, con el helper
[`test/helpers/test-database.ts`](../../test/helpers/test-database.ts) (mismas
salvaguardas: base local y nombre terminado en `_test`).

## BE-10.1. Bandeja y lectura (MP4-107)

Endpoints de la bandeja del usuario autenticado (historia H10). Viven en el
mismo `NotificationsModule` y usan el mismo `NotificationRepository` que el
servicio de avisos.

```
src/notifications/
  controllers/notificaciones.controller.ts   NotificacionesController
  services/bandeja.service.ts                listar, marcarLeida, contarNoLeidas
  dto/                                       query y respuestas de la bandeja
  repositories/notification.repository.ts    + findPageByUser, markAsRead, countUnread
```

### Endpoints

Todos exigen `Authorization: Bearer <accessToken>` y sirven a cualquier rol
con sesión (no llevan `@Roles`). Siempre operan sobre las notificaciones del
usuario del token; el cliente nunca manda un `userId`.

| Método y ruta | Respuesta | Errores |
|---|---|---|
| `GET /api/v1/notificaciones?soloNoLeidas&page&limit` | 200 `{ items, total }` | 400, 401 |
| `GET /api/v1/notificaciones/no-leidas/conteo` | 200 `{ noLeidas }` | 401 |
| `PATCH /api/v1/notificaciones/{id}/leida` (sin body) | 200 la notificación | 400, 401, 404 |

Están en Swagger (`/api/docs`, etiqueta `notificaciones`), con
`ApiBearerAuth` y los códigos de la tabla.

#### `GET /api/v1/notificaciones`

| Parámetro | Valores | Por defecto |
|---|---|---|
| `soloNoLeidas` | `true` o `false` | `false` |
| `page` | entero de 1 a 10 000 | `1` |
| `limit` | entero de 1 a 100 | `20` |

```json
{
  "items": [
    {
      "id": "0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e",
      "moduloOrigen": "RESERVAS",
      "titulo": "Reserva CONFIRMADA",
      "mensaje": "Tu reserva de «Taladro» fue confirmada.",
      "referencia": { "tipo": "reserva", "id": "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b" },
      "leidaAt": null,
      "creadaAt": "2026-11-15T10:05:00.000Z"
    }
  ],
  "total": 1
}
```

- **Orden:** más recientes primero (`created_at DESC`, y `id DESC` para
  desempatar).
- **`total`:** cuenta todas las notificaciones que cumplen el filtro, no solo
  las de la página. Con `soloNoLeidas=true`, `total` coincide con el conteo de
  no leídas.
- **`referencia`:** `{ tipo, id }`, o `null` si el aviso no tiene referencia.
- **Fechas:** `leidaAt` (`null` si no está leída) y `creadaAt`, en ISO 8601 UTC.
- Una página después de la última responde 200 con `items: []` y el `total`
  real.

#### `PATCH /api/v1/notificaciones/{id}/leida`

Sin body. Responde 200 con la notificación en la misma forma que un item de
la bandeja, con `leidaAt` ya puesto. Si ya estaba leída, responde 200 con la
fecha de la primera lectura.

#### `GET /api/v1/notificaciones/no-leidas/conteo`

```json
{ "noLeidas": 3 }
```

Solo cuenta las no leídas del usuario autenticado. Es lo que consulta el
contador de la aplicación (cada 30 segundos y con el botón Actualizar, en
FE-10.1).

### Errores

| Código | Cuándo |
|---|---|
| 400 | `page` o `limit` que no son enteros o están fuera de rango, `soloNoLeidas` distinto de `true`/`false`, un parámetro de query que no existe, o un `{id}` que no es UUID. |
| 401 | Sin token, token inválido o expirado, o cuenta inactiva (guard global de JWT). |
| 404 | La notificación no existe **o pertenece a otro usuario**. Mismo mensaje en los dos casos. |

El cuerpo de los errores es el formato por defecto de Nest, igual que en
`auth` y `users`:

```json
{ "statusCode": 404, "message": "La notificación no existe.", "error": "Not Found" }
```

El brief pide `{ "codigo", "mensaje" }`, pero el backend no tiene un filtro de
excepciones que lo produzca. Cambiarlo solo aquí dejaría dos formatos en la
misma API, y cambiarlo para todos es un cambio compartido que va en otra
task. En un 400 de validación, `message` es la lista de errores de
class-validator.

### Decisiones

- **El id es UUID, aunque el ejemplo del brief muestra `"id": 8`.** La clave
  de `notifications` es `uuid()` desde DB-10.1. La ruta valida el `{id}` con
  `ParseUUIDPipe`.
- **Un id mal formado da 400, no 404.** Es un error de sintaxis de la request,
  como un `page=abc`, y lo detecta la misma capa de validación. No revela nada,
  porque un texto que no es UUID no puede ser la notificación de nadie. La
  regla "404 si no existe o es ajena" aplica a los ids bien formados, y ahí
  los dos casos responden exactamente igual. Sin el pipe, Postgres lanzaría un
  error de tipo (22P02) y el cliente vería un 500.
- **404 sin revelar que existe.** El repositorio siempre filtra por `id` y
  `userId` juntos. Una notificación ajena y una inexistente dan el mismo
  `null`, así que el servicio no puede distinguirlas aunque quisiera.
- **PATCH atómico e idempotente.** `markAsRead` hace
  `updateManyAndReturn({ where: { id, userId, readAt: null } })`: una sola
  sentencia `UPDATE ... RETURNING` que no puede tocar filas de otro usuario ni
  otras notificaciones. Si no actualiza nada, lee `{ id, userId }`: si existe,
  ya estaba leída y se devuelve con su `leidaAt` original; si no, 404. Con
  llamadas simultáneas, solo una cumple `readAt IS NULL`, así que todas
  devuelven la misma fecha. `updateManyAndReturn` funciona con
  `@prisma/adapter-pg` en Prisma 7.10.0 (lo cubre la prueba e2e).
- **El parámetro extra en el GET da 400 a propósito.** El `ValidationPipe`
  global usa `forbidNonWhitelisted`. Así, un `?soloNoleidas=true` mal escrito
  no se ignora en silencio devolviendo la bandeja completa: el cliente recibe
  el 400 y ve el error. No es un efecto colateral que haya que "arreglar".
- **`soloNoLeidas` solo acepta `true` o `false`.** Se convierte con un
  `@Transform` propio. `@Type(() => Boolean)` convertiría `"false"` en `true`,
  porque todo texto no vacío es truthy.
- **Tope de `page` en 10 000.** Con `limit` 100, el `OFFSET` más grande es
  999 900. Sin tope, un `page` enorme haría recorrer la tabla o desbordaría el
  entero del `OFFSET`.
- **`total` con el filtro aplicado.** La página y el total se piden en un
  `$transaction([findMany, count])` con el mismo `where`.
- **Desempate por `id`.** `created_at` tiene precisión de milisegundos. Sin un
  segundo criterio, dos avisos del mismo milisegundo podrían cambiar de página
  entre una consulta y otra.
- **Uso del índice.** `(user_id, read_at, created_at DESC)` resuelve directo
  la bandeja de no leídas (`user_id = ? AND read_at IS NULL`, ya ordenada).
  Para "todas" el índice filtra por `user_id`, pero Postgres ordena después;
  con el volumen de una bandeja no pesa. No se agregó otro índice: sería una
  task de DB.
- **Orden de las rutas.** `GET no-leidas/conteo` se declara antes que las rutas
  con `:id`. Hoy no choca con `PATCH :id/leida` (otro método y otra cantidad de
  segmentos), pero así un futuro `GET :id` no se tragaría `no-leidas`.
- **Sin `userId` en la respuesta.** El repositorio selecciona solo las columnas
  de la bandeja, y `NotificacionResponseDto.fromEntity` arma la forma pública
  con los nombres del brief, como `UserResponseDto` en `users`.
- **`AvisosService` sigue siendo lo único que se exporta.** `BandejaService` es
  interno del módulo; los demás módulos registran avisos, no leen bandejas.

### Pruebas

- **Unitarias**
  ([`src/notifications/services/bandeja.service.spec.ts`](../../src/notifications/services/bandeja.service.spec.ts),
  `npm test`), con el repositorio simulado:
  - El cálculo de `skip`/`take`.
  - La forma de la respuesta: nombres del brief, `referencia` `null`, sin
    `userId`.
  - `marcarLeida`: la marca, ya leída y conserva la fecha, y el 404.
  - El conteo.
- **E2e**
  ([`test/notifications.bandeja.e2e-spec.ts`](../../test/notifications.bandeja.e2e-spec.ts),
  `npm run test:e2e`):
  - **Montaje:** la app completa contra la base `_test`, con el
    `ValidationPipe` registrado con las mismas opciones que `main.ts` (las
    pruebas no pasan por `main.ts`).
  - **Usuarios:** dos usuarios creados con Prisma y tokens firmados con el
    `JwtService` de la app.
  - **Datos:** antes de cada prueba se vuelven a sembrar con fechas fijas, así
    el orden esperado no depende del reloj.
  - **Casos:**
    - Solo devuelve las propias, en orden; la forma del item.
    - `soloNoLeidas`; paginación, la última página y una vacía.
    - 400 por paginación, filtro o parámetro extra; 401 sin sesión o con token
      inválido.
    - PATCH: la marca y deja de estar pendiente, sin afectar las demás; marca
      repetida, ya leída y llamadas simultáneas con la misma fecha.
    - Ajena 404 sin modificarla; inexistente 404 con el mismo cuerpo; id mal
      formado 400.
    - Conteo por usuario, que baja tras el PATCH y coincide con el `total` de
      las no leídas.

La base `_test` necesita todas las migraciones (ver *Prueba de
restricciones*). Después de traer migraciones nuevas de `main`, hay que
volver a correr `prisma migrate deploy` sobre ella.

## BE-10.2. Catálogo de avisos (MP4-108)

Qué avisos generan las reservas, los pagos y los mensajes (historia H10), y
la comprobación de que todos se registran con `AvisosService.notificar()` de
BE-20.1. No hay envío por correo ni SMS: el aviso queda en la bandeja del
destinatario y ahí termina.

**Este módulo no tiene lógica propia de envío.** Cada módulo emisor arma su
aviso y llama a `notificar()` después de guardar su operación. BE-10.2 no
cambió ningún emisor: los cuatro ya cumplían la ficha. Esta sección es el
catálogo vigente, sacado del código de `main`, y lo verifica
[`test/notifications.catalogo.e2e-spec.ts`](../../test/notifications.catalogo.e2e-spec.ts).

### Catálogo

| Evento | Emisor (fuente del texto) | Destinatario | Título | Mensaje | `moduloOrigen` | Referencia |
|---|---|---|---|---|---|---|
| Solicitud nueva (H03) | BE-03.1, [`reservation-notice.ts`](../../src/reservations/services/reservation-notice.ts), `buildRequestNotice` | Arrendador | Nueva solicitud de reserva | `Solicitud de «{bien}» del {inicio} al {fin}.` | `RESERVAS` | `reserva` / id de la reserva |
| Reserva CONFIRMADA (H04) | BE-04.1, [`decision-notice.ts`](../../src/reservation-decisions/services/decision-notice.ts), `buildDecisionNotice` | Arrendatario | Reserva CONFIRMADA | `Tu reserva de «{bien}» del {inicio} al {fin} fue confirmada.` | `RESERVAS` | `reserva` / id de la reserva |
| Reserva RECHAZADA (H04) | BE-04.1, ídem | Arrendatario | Reserva RECHAZADA | `Tu reserva de «{bien}» del {inicio} al {fin} fue rechazada.` + ` Motivo: {motivo}` si lo hay (recortado con «…» para no pasar de 500) | `RESERVAS` | `reserva` / id de la reserva |
| Pago APROBADO (H05) | BE-05.1, [`pagos.service.ts`](../../src/payments/services/pagos.service.ts), `PagosService.avisar` | Arrendatario | Pago aprobado | `Tu pago de ${total} por «{bien}» fue aprobado.` | `PAGOS_GARANTIA` | `pago` / id del intento |
| Pago APROBADO (H05) | BE-05.1, ídem | Arrendador | Pago confirmado | `Se confirmó el pago de ${total} de la reserva de «{bien}».` | `PAGOS_GARANTIA` | `pago` / id del intento |
| Pago RECHAZADO (H05) | BE-05.1, ídem | Arrendatario | Pago rechazado | `Tu pago de ${total} por «{bien}» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.` | `PAGOS_GARANTIA` | `pago` / id del intento |
| Mensaje nuevo (H15, H16) | BE-15.1, [`messaging.service.ts`](../../src/messaging/services/messaging.service.ts), `MessagingService.sendMessage` | El otro participante (nunca el autor) | Mensaje nuevo | `Tenés un mensaje nuevo sobre "{bien}".` | `MENSAJERIA` | `mensaje` / id del mensaje |

- `{inicio}` y `{fin}`: `dd/mm/aaaa hh:mm` en la hora de El Salvador.
- `{total}`: costo del alquiler más el depósito, con dos decimales.
- Fuera de este catálogo, BE-09.2 emite «Depósito de garantía resuelto» al
  arrendatario ([`deposit-resolutions.service.ts`](../../src/returns/services/deposit-resolutions.service.ts), `DepositResolutionsService.avisar`),
  con referencia `reserva` y los montos liberado y retenido. El contrato se
  alineó con ese aviso en esta misma task (ver
  [`docs/contratos/servicio-avisos.md`](../contratos/servicio-avisos.md)).

### Duplicados

La base guarda un solo aviso por destinatario, módulo, referencia y título
(`notifications_dedupe_key`, ver BE-20.1). Volver a llamar a `notificar()` con
el mismo aviso devuelve el id del que ya existe. Además, cada emisor corta
antes una operación repetida que no cambia nada:

| Evento | Si se repite la operación |
|---|---|
| Solicitud nueva | Cada `POST /reservas` crea otra reserva, con otro id: es otro evento y tiene su propio aviso. El mismo aviso no se registra dos veces. |
| Reserva CONFIRMADA / RECHAZADA | Repetir el `PATCH` da 409 `SOLICITUD_YA_DECIDIDA` antes de avisar. No hay aviso nuevo. |
| Pago APROBADO | Repetir el pago da 409 `PAGO_YA_APROBADO` (o `PAGO_EN_PROCESO` si hay otro en curso). No hay intento ni aviso nuevo. |
| Pago RECHAZADO | Cada intento (hasta 3) es un evento. Por eso la referencia es el intento y no la reserva: el segundo «Pago rechazado» llega aunque el título sea el mismo. |
| Mensaje nuevo | Cada mensaje es un evento y avisa una vez. Por eso la referencia es el mensaje y no la conversación. |

### Datos sensibles

Ningún aviso lleva números de tarjeta (ni los últimos 4 dígitos), CVV,
números de documentos (DUI, NIT, pasaporte), contraseñas ni el texto de un
mensaje del chat. Los avisos de pago sí llevan el **monto total**: lo pide
H05 y el contrato lo permite. Es un dato de la operación que el arrendatario
y el arrendador ya ven en su panel, no un detalle financiero sensible.

### Limitación conocida

Un intento de pago que queda en PENDIENTE porque el proceso se cayó se cierra
como RECHAZADO en el siguiente intento (`cerrarComoRechazados`, en
`PagosService.pagar` de `pagos.service.ts`), **sin aviso**. Lo mismo pasa si
otro proceso cerró el intento mientras la pasarela respondía (la rama
`if (!cerrado)` de `PagosService.pagar`). Son casos de falla del proceso, no
del flujo normal, y el intento siguiente sí avisa. No se cambió en esta task.

### Pruebas

[`test/notifications.catalogo.e2e-spec.ts`](../../test/notifications.catalogo.e2e-spec.ts)
(`npm run test:e2e`) monta la app completa contra la base `_test`, con la
pasarela sin espera. Ejecuta cada operación por HTTP y comprueba el aviso en
la base: destinatario, título, mensaje exacto, módulo de origen y referencia.
Para cada caso también vuelve a llamar a `notificar()` con el mismo aviso y
comprueba que devuelve el mismo id sin crear otro.

- **Solicitud nueva:** el aviso llega al arrendador y no al arrendatario.
- **CONFIRMADA y RECHAZADA con motivo:** el aviso llega al arrendatario.
  Repetir la decisión da 409 sin aviso nuevo.
- **Pago RECHAZADO dos veces:** dos avisos, uno por intento, solo para el
  arrendatario.
- **Pago APROBADO:** «Pago aprobado» al arrendatario y «Pago confirmado» al
  arrendador. Repetir da 409 `PAGO_YA_APROBADO`, sin intento ni aviso nuevos.
- **Rechazado y luego aprobado:** cada intento con el aviso de su resultado.
- **Mensajes H15 (publicación) y H16 (reserva confirmada), en los dos
  sentidos:** el aviso llega al otro participante, nunca al autor.
- **Datos sensibles:** barre todos los avisos de los usuarios de la prueba,
  pagos incluidos, y comprueba que no traen números de tarjeta (completos, con
  separadores o los últimos 4), el CVV, patrones de DUI o NIT, las palabras
  CVV, contraseña o password, el hash de la contraseña ni el texto del chat.

Corre en paralelo con el resto de la suite: filtra por sus propios usuarios
(email con sufijo único) y referencias, nunca por conteos globales, y en
`afterAll` borra lo que creó de abajo hacia arriba.
