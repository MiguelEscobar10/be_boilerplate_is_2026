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
(historia H20). **No es un endpoint público:** el módulo no tiene controllers.
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

No hay ruta, así que no hay nada que documentar en Swagger. El criterio de
permisos se cumple porque el servicio no se puede llamar desde afuera: la
prueba e2e verifica que `POST /api/v1/notificaciones` y `POST /api/v1/avisos`
responden 404.

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
