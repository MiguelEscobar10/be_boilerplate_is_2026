# Módulo 0: Cuentas, roles y acceso

Base que usan todas las historias: cada cuenta tiene un rol y el backend
decide qué puede hacer según ese rol (sección 2.1 del documento de historias).

## DB-00.1. Rol y perfil de usuario (MP4-125)

Migración
[`20261114215749_add_user_role_and_profile`](../../prisma/migrations/20261114215749_add_user_role_and_profile/migration.sql).

### Cambio en `users`

Se agrega una sola columna a la tabla de la cátedra:

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `role` | `UserRole` | no | `ARRENDADOR`, `ARRENDATARIO` o `REVISOR`. Por defecto `ARRENDATARIO`. |

El valor por defecto existe para que la migración no falle con las cuentas que
ya estaban creadas (por ejemplo, el usuario demo del seed). Las cuentas nuevas
siempre traen el rol que eligieron al registrarse (BE-00.1).

### Tabla `user_profiles` (modelo Prisma `UserProfile`)

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `id` | `UUID` | no | Clave primaria. |
| `user_id` | `UUID` | no | FK única a `users.id`, `ON DELETE CASCADE`. Un perfil por cuenta. |
| `name` | `VARCHAR(100)` | no | Nombre visible. No puede estar en blanco. |
| `phone` | `VARCHAR(20)` | no | Solo dígitos, de 8 a 15. `CHECK (phone ~ '^[0-9]{8,15}$')`. |
| `created_at` / `updated_at` | `TIMESTAMP(3)` | no | Fechas de control. |

### Equivalencias con el brief

| Brief | Columna en la base | Campo en Prisma |
|---|---|---|
| `usuario.rol` | `users.role` | `User.role` |
| `RolUsuario` (enum) | `UserRole` | `UserRole` |
| `perfil_usuario` (tabla) | `user_profiles` | `UserProfile` |
| `nombre` | `name` | `name` |
| `telefono` | `phone` | `phone` |

### Usuario REVISOR

No se puede registrar por la API. `npm run db:seed` lo crea (o lo actualiza)
con `revisor@example.com / Revisor1234!`, o con `SEED_REVIEWER_EMAIL` y
`SEED_REVIEWER_PASSWORD` si están definidas. En la demo desplegada
(`NODE_ENV=production`) esas dos variables son obligatorias: si faltan, el
seed se detiene para no publicar una contraseña conocida.

### Prueba de restricciones

[`test/accounts.constraints.e2e-spec.ts`](../../test/accounts.constraints.e2e-spec.ts)
comprueba el rol por defecto, los tres roles válidos, el rechazo de otro valor,
el perfil único por cuenta, las reglas del teléfono y del nombre, y el borrado
en cascada.

## BE-00.1. Registro con rol, /auth/me y guard de roles (MP4-126)

### Registro

Se reutiliza el registro que ya traía el boilerplate (`POST /api/v1/users`)
en lugar de crear `POST /auth/registro`: es el mismo recurso y así no hay dos
formas de crear una cuenta. El frontend puede tener las dos pantallas
(`/registro/arrendador` y `/registro/arrendatario`) llamando al mismo endpoint.

```json
{
  "email": "lee@example.com",
  "password": "Str0ngPass",
  "rol": "ARRENDADOR",
  "nombre": "Lee Fuentes",
  "telefono": "70001234"
}
```

- `rol` solo acepta `ARRENDADOR` o `ARRENDATARIO`. Vacío, `REVISOR`, `ADMIN`
  o cualquier otro valor responde **400** con el mensaje `ROL_NO_PERMITIDO` y
  no crea la cuenta. No hay ningún endpoint para cambiar el rol después.
- La cuenta y el perfil se crean en la misma operación.
- La respuesta (y la de `GET /api/v1/auth/me`) incluye `rol`, `nombre` y
  `telefono`.

### Cómo proteger una ruta por rol

```ts
import { Roles } from '@Auth/decorators';

@Roles('ARRENDADOR')
@Post()
create() { ... }
```

- Sin sesión: **401** (lo responde `JwtAuthGuard`, que corre primero).
- Con sesión pero con otro rol: **403**.
- Sin `@Roles`, la ruta solo exige sesión, como antes.
- El rol se lee de la base en cada request (el guard de JWT recarga el
  usuario), nunca del token ni de lo que mande el cliente.

### Pruebas

- [`src/auth/guards/roles.guard.spec.ts`](../../src/auth/guards/roles.guard.spec.ts):
  casos del guard (sin `@Roles`, rol permitido, varios roles, 403).
- [`test/accounts.e2e-spec.ts`](../../test/accounts.e2e-spec.ts): registro de
  cada rol, rechazo de `REVISOR`/`ADMIN`/vacío, validaciones de nombre y
  teléfono, y `/auth/me`.
