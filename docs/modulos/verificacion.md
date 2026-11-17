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

- **BE-07.2:** cola del REVISOR, entrega protegida del documento y decisión
  (`PATCH /api/v1/verificaciones/{id}/decision`).

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

## DB-19.1. Opción "requiere verificación" en la publicación (MP4-102)

### Modelo de datos

Migración
[`20261116080603_add_listing_requires_verification`](../../prisma/migrations/20261116080603_add_listing_requires_verification/migration.sql).

**Columna nueva en `listings`** (campo Prisma `Listing.requiresVerification`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `requires_verification` | `BOOLEAN` | no | Si es `true`, solo la pueden solicitar arrendatarios con una verificación `APROBADA`. `false` por defecto. |

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `publicacion.requiere_verificacion` | `listings.requires_verification` | `Listing.requiresVerification` |

### Decisiones

- **`DEFAULT false` en la misma sentencia.** El `ALTER TABLE ... ADD COLUMN ...
  NOT NULL DEFAULT false` deja en `false` a todas las publicaciones que ya
  existían, sin un `UPDATE` aparte. Nadie queda exigiendo verificación sin
  haberlo decidido.
- **"Verificado" no se guarda en `users`.** Una persona está verificada si
  tiene alguna fila `APROBADA` en `identity_verifications` (DB-07.1). BE-19.1 lo
  consulta con `count(*) WHERE user_id = ? AND status = 'APROBADA'`, que usa el
  índice `(user_id, submitted_at DESC)`. Así no hay dos datos que puedan
  contradecirse. Una `RECHAZADA` o `PENDIENTE` posterior no le quita la
  verificación a quien ya tiene una `APROBADA`.
- **Sin índice sobre la columna.** Solo se lee junto con la publicación que se
  está solicitando (por `id`), nunca para filtrar el catálogo.

### Prueba

[`test/verification.requirement.constraints.e2e-spec.ts`](../../test/verification.requirement.constraints.e2e-spec.ts)
comprueba el valor por defecto, que un `INSERT` sin la columna (como las filas
de antes de la migración) quede en `false`, el tipo `BOOLEAN NOT NULL DEFAULT
false`, el rechazo de `NULL`, activar y desactivar la opción, y la consulta de
"verificado": `APROBADA` sí; `PENDIENTE`, `RECHAZADA` o ninguna, no; una
`APROBADA` sigue contando aunque después haya otras, y la de un usuario no
cuenta para otro. También comprueba que `users` no tiene una columna de
verificación.

## BE-19.1. Opción y validación de la verificación (MP4-103)

### Endpoint

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| `PATCH` | `/api/v1/publicaciones/{id}/requiere-verificacion` | `ARRENDADOR` dueño | `200 { id, requiereVerificacion }` |

Cuerpo: `{ "requiereVerificacion": true }`.

- **400** si `requiereVerificacion` falta o no es booleano (`"true"` como texto
  o `1` no sirven), si viene un campo de más o si el id no es un UUID.
- **401** sin sesión; **403** si la cuenta no es `ARRENDADOR` o si la
  publicación no es suya (el contrato de BE-19.1 pide 403, no 404); **404** si
  la publicación no existe.
- Repetir el valor que ya tiene responde 200 sin escribir.

El controller (`ListingVerificationController`) vive en este módulo y comparte
el prefijo `publicaciones` con el de BE-01.1, que no se tocó. Solo cambia
`listings.requires_verification`.

### Regla para BE-03.1: `exigeVerificacionYNoCumple`

`VerificationRequirementService.exigeVerificacionYNoCumple(publicacionId,
arrendatarioId)` devuelve `true` cuando la publicación exige verificación y el
arrendatario **no** tiene una verificación `APROBADA` (no tiene ninguna, o solo
`PENDIENTE` o `RECHAZADA`). En ese caso la solicitud de reserva no se registra.
Devuelve `false` si la publicación no la exige, si el arrendatario está
verificado o si la publicación no existe (ese 404 lo decide BE-03.1).

Cómo usarla desde reservas:

```ts
// reservations.module.ts
imports: [VerificationModule],

// reservations.service.ts
import { VerificationRequirementService } from '@Verification/services';
import { VerificacionRequeridaException } from '@Verification/errors';

if (await this.requisito.exigeVerificacionYNoCumple(publicacionId, arrendatarioId)) {
  throw new VerificacionRequeridaException();
}
```

`VerificacionRequeridaException` responde **422** con el formato de Nest y un
`codigo` para que el frontend (FE-19.1) reconozca el caso sin depender del
texto:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "codigo": "VERIFICACION_REQUERIDA",
  "message": "Esta publicación solo acepta usuarios verificados. Envía tu documento de identidad para verificarte."
}
```

### Pruebas

- [`src/verification/services/verification-requirement.service.spec.ts`](../../src/verification/services/verification-requirement.service.spec.ts):
  dueño, no dueño (403), publicación inexistente (404), valor repetido, los
  cuatro casos de la regla y el cuerpo del 422.
- [`test/verification.requirement.e2e-spec.ts`](../../test/verification.requirement.e2e-spec.ts):
  activar y desactivar, 403 a otro arrendador y a un arrendatario, 401, 404,
  los 400 por valor inválido, y la regla contra la base: publicación que la
  exige con arrendatario sin verificación, `PENDIENTE`, `RECHAZADA` o
  `APROBADA`; publicación que no la exige; y que activar la opción por el
  endpoint hace que la regla empiece a rechazar.
