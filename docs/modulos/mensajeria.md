# Módulo 5: Mensajería entre arrendador y arrendatario

Conversaciones antes de reservar (H15) y durante una reserva (H16). Las dos
usan las mismas tablas; lo que cambia es si la conversación tiene reserva.

## DB-15.1. Conversaciones y mensajes (MP4-81)

Migración
[`20261115165319_create_conversations_and_messages`](../../prisma/migrations/20261115165319_create_conversations_and_messages/migration.sql).

### Tabla `conversations` (modelo Prisma `Conversation`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `listing_id` | `UUID` | no | Publicación sobre la que se conversa. FK a `listings.id`, `ON DELETE RESTRICT`. |
| `tenant_id` | `UUID` | no | Arrendatario. FK a `users.id`, `ON DELETE RESTRICT`. |
| `landlord_id` | `UUID` | no | Arrendador. FK a `users.id`, `ON DELETE RESTRICT`. |
| `reservation_id` | `UUID` | sí | `NULL` = conversación previa a la reserva (H15). La FK la agrega DB-16.1. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de creación. |

- Índice único parcial `conversations_pre_reservation_key` sobre
  `(listing_id, tenant_id) WHERE reservation_id IS NULL`: una sola conversación
  previa entre el mismo arrendatario y la misma publicación. Si el
  arrendatario vuelve a escribir, se reutiliza esa conversación (BE-15.1
  responde 200 con la existente).
- `CHECK (tenant_id <> landlord_id)`: el arrendador no puede abrir una
  conversación sobre su propia publicación.
- Índices sobre `tenant_id` y `landlord_id` para listar "mis conversaciones".

### Tabla `messages` (modelo Prisma `Message`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `conversation_id` | `UUID` | no | FK a `conversations.id`, `ON DELETE CASCADE`. |
| `author_id` | `UUID` | no | Quien escribió. FK a `users.id`, `ON DELETE RESTRICT`. |
| `content` | `VARCHAR(1000)` | no | Texto. `CHECK` de que no esté vacío ni sea solo espacios. |
| `created_at` | `TIMESTAMP(3)` | no | Fecha de envío. |

Índice `(conversation_id, created_at, id)` para leer el historial en orden
cronológico y paginado; `id` desempata dos mensajes del mismo instante.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `conversacion` (tabla) | `conversations` | `Conversation` |
| `publicacion_id` | `listing_id` | `listingId` |
| `arrendatario_id` | `tenant_id` | `tenantId` |
| `arrendador_id` | `landlord_id` | `landlordId` |
| `reserva_id` | `reservation_id` | `reservationId` |
| `mensaje` (tabla) | `messages` | `Message` |
| `autor_id` | `author_id` | `authorId` |
| `contenido` | `content` | `content` |

### Decisiones

- **`reservation_id` todavía sin FK.** La tabla de reservas llega con DB-03.1
  (Mario). Para no bloquear la mensajería, la columna ya existe y DB-16.1
  agrega la FK y el índice único `(reservation_id)` cuando esa tabla esté en
  `main`.
- **`landlord_id` guardado aunque se pueda sacar de la publicación.** Así las
  consultas de "mis conversaciones" y el control de quién participa no
  necesitan unir con `listings`, y el `CHECK` de participantes distintos se
  puede hacer en la base.
- **Que el autor sea uno de los dos participantes lo valida el backend**
  (BE-15.1). Hacerlo en la base pediría un trigger, y la regla ya se revisa
  para responder 404 a quien no participa.
- **`CASCADE` en mensajes, `RESTRICT` en lo demás.** Un mensaje no existe sin
  su conversación; una publicación o un usuario con conversaciones no se borra
  por accidente.

### Prueba de restricciones

[`test/messaging.constraints.e2e-spec.ts`](../../test/messaging.constraints.e2e-spec.ts)
comprueba el historial en orden, la conversación previa única (y que otro
arrendatario o una conversación de reserva no chocan), los participantes
distintos, las FK, el contenido vacío o de más de 1000 caracteres y el
comportamiento al borrar.

## BE-15.1. Conversaciones y mensajes antes de reservar (MP4-82)

### Endpoints

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `POST` | `/api/v1/publicaciones/{id}/conversaciones` | `ARRENDATARIO` | `201 { id }` si es nueva, `200 { id }` si ya existía |
| `POST` | `/api/v1/conversaciones/{id}/mensajes` | participante | `201 { id, createdAt }` |
| `GET` | `/api/v1/conversaciones/{id}/mensajes?page=1&limit=50` | participante | `200 { items, page, limit, total }` en orden cronológico |

Cuerpo del mensaje: `{ "contenido": "¿Incluye las brocas?" }`.

### Reglas

- `contenido` de 1 a 1000 caracteres. Se guarda sin los espacios de los
  extremos; un texto de solo espacios cuenta como vacío y responde **400**.
- Solo los dos participantes leen y escriben. Para cualquier otra persona la
  conversación "no existe": **404**, igual que una conversación inexistente.
- Solo un `ARRENDATARIO` abre conversaciones (**403** para el resto). Una
  publicación inexistente, desactivada o propia responde **404**.
- Si dos peticiones abren la misma conversación al mismo tiempo, el índice
  único de DB-15.1 evita el duplicado y las dos reciben la misma.
- `limit` va de 1 a 100 (por defecto 50).

### Aviso al otro participante

Cada mensaje guardado llama a `AvisosService.notificar` (Módulo 8) con:

| Campo | Valor |
|---|---|
| `destinatarioId` | El otro participante |
| `titulo` | `Mensaje nuevo` |
| `mensaje` | `Tenés un mensaje nuevo sobre "<nombre del bien>".` (sin el texto del mensaje) |
| `moduloOrigen` | `MENSAJERIA` |
| `referencia` | `{ tipo: 'mensaje', id: <id del mensaje> }` |

Como cada mensaje tiene su propio id, cada uno genera su aviso y el índice de
duplicados de notificaciones no los bloquea. Si el aviso falla, el mensaje no
se pierde: ya quedó guardado y el error se registra en el log.

### Pruebas

[`test/messaging.e2e-spec.ts`](../../test/messaging.e2e-spec.ts): abrir y
reutilizar la conversación, historial en orden y paginado, el aviso (y que no
lleve el texto), mensajes vacíos o largos, privacidad (404), roles (403) y
sesión (401).
