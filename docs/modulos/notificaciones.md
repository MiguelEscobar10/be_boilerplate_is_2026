# Módulo 8: Notificaciones

Avisos informativos asociados a un usuario (historia H10). Los registra el
servicio de avisos (H20) y se consultan desde la bandeja de cada usuario.

## DB-10.1. Entidad de notificaciones por usuario (MP4-106)

### Modelo de datos

Tabla `notifications` (modelo Prisma `Notification`), migración
[`20261114191557_create_notifications`](../../prisma/migrations/20261114191557_create_notifications/migration.sql).

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `user_id` | `UUID` | no | Destinatario. FK a `users.id`, `ON DELETE CASCADE`. |
| `source_module` | `TEXT` | no | Módulo que originó el aviso. Pasa al enum `ModuloOrigen` en DB-20.1. |
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
- **`source_module` es `TEXT NOT NULL` por ahora.** El enum `ModuloOrigen`, los
  límites de `title` (1 a 100) y `message` (1 a 500) y el índice único parcial
  contra duplicados son el alcance de DB-20.1, que depende de esta task. Esa
  migración convierte la columna con `ALTER COLUMN ... TYPE "ModuloOrigen" USING ...`.
- **`reference_id` es `TEXT`, no `UUID`.** La referencia puede apuntar a
  entidades de cualquier módulo, así que no se ata al tipo de clave de ninguno.
- **`ON DELETE CASCADE` y sin `updated_at`.** Igual que `refresh_tokens`: los
  avisos no tienen sentido sin su destinatario. Lo único que cambia después de
  crear un aviso es `read_at`, que ya guarda cuándo se leyó.
- **Sin datos sensibles en `title` ni `message`.** Nunca números de tarjeta,
  códigos de seguridad ni contraseñas. La base no puede verificarlo; lo
  garantiza el servicio de avisos (BE-20.1) y quien lo llama.

### Prueba de restricciones

[`test/notifications.constraints.e2e-spec.ts`](../../test/notifications.constraints.e2e-spec.ts)
comprueba la FK, los `NOT NULL`, el borrado en cascada, las consultas de
pendientes y recientes y que esas consultas usan el índice.

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
