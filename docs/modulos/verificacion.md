# Módulo 7: Verificación de identidad y documentos

Solicitudes con las que un arrendatario envía su documento de identidad para
que lo revise el usuario REVISOR (historia H07), y la opción con la que el
arrendador exige verificación para rentar un bien (H19). Una persona está
verificada cuando tiene alguna solicitud `APROBADA`.

## DB-07.1. Solicitudes de verificación de identidad (MP4-97)

### Modelo de datos

Migración
[`20261116075258_create_identity_verifications`](../../prisma/migrations/20261116075258_create_identity_verifications/migration.sql).

**Tabla `identity_verifications`** (modelo Prisma `IdentityVerification`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria, generada por Prisma (`uuid()`). |
| `user_id` | `UUID` | no | Arrendatario que envía el documento. FK a `users.id`, `ON DELETE CASCADE`. |
| `document_key` | `VARCHAR(255)` | no | Ruta privada del documento en el almacenamiento. No es una URL pública. `CHECK` de al menos un carácter que no sea espacio. |
| `status` | `IdentityVerificationStatus` | no | Estado de la solicitud. `PENDIENTE` por defecto. |
| `rejection_reason` | `VARCHAR(500)` | sí | Motivo que escribe el REVISOR al rechazar (opcional). Solo en `RECHAZADA`. |
| `reviewed_by` | `UUID` | sí | REVISOR que decidió. FK a `users.id`, `ON DELETE RESTRICT`. |
| `reviewed_at` | `TIMESTAMP(3)` | sí | Fecha de la decisión, en UTC. No puede ser anterior a `submitted_at`. |
| `submitted_at` | `TIMESTAMP(3)` | no | Fecha de envío, en UTC. `now()` por defecto. |

**Enum `IdentityVerificationStatus`**: `PENDIENTE`, `APROBADA`, `RECHAZADA`
(sección 2.3 del documento de historias). Los valores se quedan en español
porque son los mismos que viajan en la API (`estado`).

**Índices**

| Índice | Columnas | Para qué |
|---|---|---|
| `identity_verifications_user_id_submitted_at_idx` | `(user_id, submitted_at DESC)` | La última solicitud del usuario (`GET /usuarios/me/verificaciones/ultima`, BE-07.1). |
| `identity_verifications_status_submitted_at_idx` | `(status, submitted_at)` | La cola del REVISOR: solicitudes `PENDIENTE` en orden de llegada (BE-07.2). |
| `identity_verifications_one_pending_per_user_key` | `(user_id) WHERE status = 'PENDIENTE'` | Único parcial: una sola solicitud `PENDIENTE` por usuario. |

**Restricciones `CHECK`** (escritas a mano al final de la migración)

| Nombre | Regla |
|---|---|
| `identity_verifications_document_key_check` | `document_key` tiene algún carácter que no es espacio en blanco. |
| `identity_verifications_review_check` | En `PENDIENTE`, `reviewed_by` y `reviewed_at` son `NULL`; en `APROBADA` o `RECHAZADA`, los dos están presentes. |
| `identity_verifications_reviewer_not_owner_check` | `reviewed_by <> user_id`: nadie decide su propia solicitud. |
| `identity_verifications_rejection_reason_check` | El motivo es `NULL`, o la solicitud está `RECHAZADA` y el motivo tiene algún carácter que no es espacio en blanco. |
| `identity_verifications_reviewed_at_check` | `reviewed_at >= submitted_at`. |

La tabla `users` no cambia: las relaciones inversas
(`User.identityVerifications` y `User.reviewedIdentityVerifications`) existen
solo en el cliente de Prisma.

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `verificacion_identidad` (tabla) | `identity_verifications` | `IdentityVerification` |
| `usuario_id` | `user_id` | `userId` |
| `documento_key` | `document_key` | `documentKey` |
| `estado` | `status` | `status` |
| `motivo_rechazo` | `rejection_reason` | `rejectionReason` |
| `revisada_por` | `reviewed_by` | `reviewedById` |
| `revisada_at` | `reviewed_at` | `reviewedAt` |
| `enviada_at` | `submitted_at` | `submittedAt` |

### Decisiones

- **Una fila por envío.** Una solicitud `RECHAZADA` no se reabre: la persona
  envía otra y queda como una fila nueva (sección 2.3). Así se conserva el
  historial de decisiones con su revisor. La "última" solicitud es la de
  `submitted_at` más reciente.
- **Una sola `PENDIENTE` por usuario, también en la base.** Además de que
  BE-07.1 responda `409` si ya hay una, el índice único parcial impide que dos
  envíos simultáneos registren dos pendientes. Las `APROBADA` y `RECHAZADA`
  pueden ser varias.
- **La decisión va completa o no va.** El `CHECK` de revisión obliga a guardar
  el revisor y la fecha juntos, y solo cuando la solicitud deja de estar
  `PENDIENTE`. Pasar de `PENDIENTE` a una decisión es un `UPDATE` de la misma
  fila; impedir que se decida dos veces (`409`) es trabajo de BE-07.2.
- **`CASCADE` en el usuario y `RESTRICT` en el revisor.** El documento es un
  dato personal: si se borra la cuenta, sus solicitudes se van con ella. La
  decisión, en cambio, no debe quedar sin su revisor, así que no se puede
  borrar a un REVISOR que ya decidió solicitudes.
- **El documento nunca tiene URL pública.** Solo se guarda su ruta privada en
  `document_key` (por ejemplo `verificaciones/<user_id>/<uuid>.pdf`). El archivo
  se guarda fuera de cualquier carpeta servida como estática y solo se entrega
  al REVISOR por la ruta protegida de BE-07.2. Las respuestas de BE-07.1 no
  incluyen esta columna.
- **Motivo de hasta 500 caracteres.** El documento no fija un largo; se usa el
  mismo de los motivos de rechazo de reservas (supuesto 4 de la sección 2.5).
- **Verificada = tiene alguna `APROBADA`.** No se duplica el dato en `users`:
  H19 (DB-19.1 y BE-19.1) lo consulta con
  `count(*) WHERE user_id = ? AND status = 'APROBADA'`.

### Qué queda para otras tasks

- **DB-19.1:** `listings.requires_verification`.

### Prueba de restricciones

[`test/verification.constraints.e2e-spec.ts`](../../test/verification.constraints.e2e-spec.ts)
comprueba el estado inicial `PENDIENTE` sin decisión, los tres estados y el
rechazo de uno fuera del enum, las decisiones `APROBADA` y `RECHAZADA` (con y
sin motivo), el paso de `PENDIENTE` a una decisión, la única `PENDIENTE` por
usuario (y que después de una decisión se puede enviar otra), la coherencia de
revisor y fecha, que nadie decida su propia solicitud, que la revisión no sea
anterior al envío, los motivos vacíos o en el estado equivocado, los límites de
500 y 255 caracteres, las FK y el comportamiento al borrar (`CASCADE` y
`RESTRICT`), los tres índices y la consulta de "verificada".

Corre contra la misma base de pruebas que las demás:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" \
  npx prisma migrate deploy
npm run test:e2e
```

## BE-07.1. Envío y consulta de la verificación (MP4-98)

### Endpoints

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `POST` | `/api/v1/usuarios/me/verificaciones` | `ARRENDATARIO` | `201 { id, estado: "PENDIENTE" }` |
| `GET` | `/api/v1/usuarios/me/verificaciones/ultima` | `ARRENDATARIO` | `200 { id, estado, motivoRechazo, enviadaAt, revisadaAt }` |

El `POST` recibe `multipart/form-data` con un solo archivo en el campo
`documento`. Ninguna respuesta incluye el documento ni su ruta.

### Reglas

- **Formato y tamaño.** JPG, PNG o PDF de máximo 5 MB. El tipo se decide por la
  firma del archivo (sus primeros bytes), no por la extensión ni por el
  `Content-Type`, que manda el cliente: un `.txt` renombrado a `.pdf` responde
  **400**. Más de 5 MB, un archivo vacío, ninguno o uno en otro campo también
  responden **400** con un mensaje que el frontend puede mostrar tal cual. En
  ningún caso se registra la solicitud ni queda el archivo guardado.
- **Una sola `PENDIENTE`.** Si ya hay una, responde **409** ("Esperá la
  respuesta del revisor") y no registra otra. Primero se consulta para no
  escribir el archivo en el caso común; si dos envíos llegan al mismo tiempo,
  decide el índice único parcial de DB-07.1 y el que pierde también recibe
  **409** y su archivo se borra. Después de una `APROBADA` o `RECHAZADA` se
  puede enviar otra.
- **Solo la propia.** Las dos rutas usan el usuario de la sesión, así que
  nadie puede pedir la solicitud de otro. Si todavía no envió ninguna, el `GET`
  responde **404**. `motivoRechazo` solo viene si la solicitud está
  `RECHAZADA` y el revisor escribió uno.
- **Solo arrendatarios.** Sin sesión responde **401**; un `ARRENDADOR` o un
  `REVISOR` reciben **403** (supuesto 2 de la sección 2.5: el arrendador no se
  verifica).
- Los errores usan el formato por defecto de Nest (`{ statusCode, message,
  error }`), igual que el resto de los módulos.

### Dónde quedan los documentos

En `UPLOADS_DIR/verificaciones/<uuid>.<jpg|png|pdf>`, con el nombre generado
por el servidor (nunca el que manda el cliente). En la base solo queda la ruta
relativa en `document_key`. Ninguna ruta pública sirve esa carpeta: el
documento solo lo abre el REVISOR por la ruta protegida de BE-07.2. Si el
insert falla después de escribir el archivo, el archivo se borra.

### Pruebas

- [`src/verification/services/verification.service.spec.ts`](../../src/verification/services/verification.service.spec.ts):
  validación del archivo, el 409 (también cuando gana otra petición) y la
  limpieza del archivo si el insert falla.
- [`test/verification.e2e-spec.ts`](../../test/verification.e2e-spec.ts):
  envío de PDF, PNG y JPG, el 409 y dos envíos simultáneos, una nueva después
  de una `RECHAZADA`, archivo falso, grande, ausente o en otro campo (400),
  sesión (401) y rol (403); la consulta de la última, con motivo, la más
  reciente entre varias, que nadie ve la de otro y el 404 sin solicitudes.

## BE-07.2. Revisión manual con permisos (MP4-99)

### Endpoints

Todos solo para el rol `REVISOR` (lo crea el seed; nadie se registra con ese
rol). Sin sesión responden **401** y con cualquier otro rol **403**, incluido
el arrendatario dueño de la solicitud.

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/v1/verificaciones?estado=PENDIENTE` | `200 [{ id, estado, usuario: { id, email, nombre }, enviadaAt, motivoRechazo, revisadaAt, documentoUrl }]` en orden de llegada |
| `GET` | `/api/v1/verificaciones/{id}/documento` | `200` con el archivo y su `Content-Type` (`application/pdf`, `image/png` o `image/jpeg`) |
| `PATCH` | `/api/v1/verificaciones/{id}/decision` | `200 { id, estado }` |

Cuerpo de la decisión: `{ "decision": "APROBAR" }` o
`{ "decision": "RECHAZAR", "motivo": "Documento ilegible" }`.

### Reglas

- **`estado`** es opcional (por defecto `PENDIENTE`); un valor que no sea
  `PENDIENTE`, `APROBADA` o `RECHAZADA` responde **400**.
- **El documento solo sale por su ruta protegida.** La cola no devuelve la ruta
  privada (`document_key`), solo `documentoUrl`, que exige el rol REVISOR. La
  respuesta del archivo va con `Cache-Control: private, no-store` para que no
  quede en una caché compartida. La carpeta `UPLOADS_DIR` no se sirve como
  estática (hay prueba).
- **El documento se entrega con `X-Content-Type-Options: nosniff`**, y si el
  archivo ya no está en disco la ruta responde un **404** genérico ("El
  documento no está disponible."), sin la ruta del servidor.
- **Decisión.** `APROBAR` deja la solicitud `APROBADA`; `RECHAZAR` la deja
  `RECHAZADA` con el motivo si viene (se guarda sin los espacios de los
  extremos). En los dos casos se registran `reviewed_by` y `reviewed_at`.
  Responde **400** si la decisión no es `APROBAR` ni `RECHAZAR`, si se manda un
  motivo al aprobar, o si el motivo está vacío o pasa de 500 caracteres.
- **No se decide dos veces.** Si la solicitud ya está `APROBADA` o `RECHAZADA`
  responde **409** y no cambia nada. El `UPDATE` filtra por
  `status = 'PENDIENTE'`, así que si dos revisores deciden a la vez, uno recibe
  200 y el otro 409.
- **404** si la solicitud no existe; **400** si el id no es un UUID.
- `reviewed_at` es la hora de la aplicación, pero nunca anterior a
  `submitted_at` (el `CHECK` de DB-07.1 lo exige y los relojes de la app y de la
  base pueden diferir unos milisegundos).
- El arrendatario ve el resultado en `GET /usuarios/me/verificaciones/ultima`
  (BE-07.1). La sección 2.4 no define un aviso para H07, así que la decisión no
  llama a `notificar()`.

### Pruebas

- [`src/verification/services/review.service.spec.ts`](../../src/verification/services/review.service.spec.ts):
  aprobar, rechazar con y sin motivo, motivo al aprobar (400), 404, 409 por
  solicitud ya resuelta y por decisión simultánea.
- [`test/verification.review.e2e-spec.ts`](../../test/verification.review.e2e-spec.ts):
  la cola en orden y sin la ruta privada, el filtro por estado, el documento
  (tipo, caché y que nadie más lo obtenga, ni por ruta estática), aprobar y
  rechazar (y que el arrendatario lo vea), enviar otra después de un rechazo,
  el 409 al decidir otra vez, dos decisiones simultáneas, los 400, 401, 403 y
  404. También prueba el repositorio directo: una segunda llamada a
  `decide` devuelve `null` sin cambiar la primera decisión, y con el reloj de
  la aplicación atrasado `reviewed_at` queda igual a `submitted_at`.
