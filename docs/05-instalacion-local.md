# Instalación local

Cómo levantar el backend y el frontend en una máquina de desarrollo. La guía
técnica completa del backend (Docker, Prisma, autenticación y scripts) está
en el [README](../README.md).

## Requisitos

- Docker y Docker Compose v2 o superior (la base es la imagen
  `postgres:18-alpine`).
- Node.js 24 con su npm (solo si se corre fuera de Docker). Es la versión de
  las imágenes de los dos repositorios; con npm 10 (Node 22) `npm ci` falla
  por el lock ([despliegue.md](despliegue.md)).
- Git, para clonar los dos repositorios.

## Pasos

1. Clonar los dos repositorios, uno al lado del otro:

   ```bash
   git clone https://github.com/MiguelEscobar10/be_boilerplate_is_2026.git
   git clone https://github.com/MiguelEscobar10/fe_boilerplate_is_2026.git
   cd be_boilerplate_is_2026
   ```

2. Copiar el archivo de variables: `cp .env.example .env` y completar los
   valores. Como mínimo, cambiar `JWT_SECRET` por uno propio de 32 caracteres
   o más (`openssl rand -base64 32`).
3. Levantar los servicios. Hay dos formas:
   - **Todo con Docker:** `docker compose up --build`. La API aplica las
     migraciones al arrancar (`prisma migrate deploy`).
   - **Base en Docker y API en el host** (recomendada para desarrollar):

     ```bash
     docker compose up -d postgres
     npm install                 # el postinstall genera el cliente de Prisma
     npm run prisma:migrate      # aplica las 23 migraciones
     npm run start:dev           # modo watch
     ```

4. Cargar los datos semilla: `npm run db:seed` (con todo en Docker:
   `docker compose exec api npx prisma db seed`). Es idempotente: si una
   cuenta ya existe, le asegura el rol pero no le cambia la contraseña. Crea
   una cuenta por rol ([`prisma/seed.ts`](../prisma/seed.ts)):

   | Cuenta | Rol | Contraseña en desarrollo |
   |---|---|---|
   | `arrendador@example.com` (o `SEED_LANDLORD_EMAIL`) | ARRENDADOR | `Arrendador1234!` (o `SEED_LANDLORD_PASSWORD`) |
   | `arrendatario@example.com` (o `SEED_TENANT_EMAIL`) | ARRENDATARIO | `Arrendatario1234!` (o `SEED_TENANT_PASSWORD`) |
   | `revisor@example.com` (o `SEED_REVIEWER_EMAIL`) | REVISOR | `Revisor1234!` (o `SEED_REVIEWER_PASSWORD`) |

   En producción (`NODE_ENV=production`) no hay accesos por defecto: el seed
   exige `SEED_LANDLORD_*`, `SEED_TENANT_*` y `SEED_REVIEWER_*` (email y
   contraseña de cada una), falla si falta alguna y no imprime las
   contraseñas. En desarrollo también crea el usuario `demo@example.com` que
   trae el boilerplate (sin perfil); no es una cuenta del proyecto y no se
   crea en producción.

   También crea datos de ejemplo (en desarrollo y en producción), todos a
   nombre de la cuenta ARRENDADOR:

   - 5 publicaciones activas de equipos y espacios, con tarifas por hora,
     día, noche y semana, y depósito. El proyector multimedia **requiere
     verificación** de identidad.
   - Un bloqueo de 3 días en la cabaña, dos semanas después de la primera
     corrida.
   - Dos reservas del ARRENDATARIO: una **PENDIENTE** del salón (una semana
     después, para aprobar o rechazar y luego pagar) y una **CONFIRMADA** del
     taladro que empezó el día anterior (para pagar, registrar la entrega y
     la devolución).

   Cada fila tiene un id fijo (empieza con `5eed`) y, si ya existe, no se
   toca: correr el seed otra vez no duplica nada ni deshace lo hecho en la
   demo. Las fechas se fijan en la primera corrida; para regenerarlas,
   `npm run db:reset`. Las publicaciones no llevan fotos (las imágenes viven
   en disco y en Render se pierden al reiniciar); el frontend muestra "Sin
   fotografía".
5. Levantar el frontend en otra terminal:

   ```bash
   cd ../fe_boilerplate_is_2026
   cp .env.example .env.local   # trae API_URL=http://localhost:3000/api/v1
   npm install
   npm run dev -- -p 3001
   ```

6. Abrir [http://localhost:3001](http://localhost:3001). La API queda en
   `http://localhost:3000/api/v1` y Swagger en
   `http://localhost:3000/api/docs`.

## Variables de entorno

Las del backend salen de [`.env.example`](../.env.example). La aplicación las
valida al arrancar (`src/config/env.validation.ts`): sin `DATABASE_URL` o sin
un `JWT_SECRET` de 32 caracteres o más, no arranca.

| Variable | Descripción | Ejemplo |
|---|---|---|
| `NODE_ENV` | Entorno de ejecución | `development` |
| `PORT` | Puerto HTTP de la API | `3000` |
| `POSTGRES_USER` | Usuario que crea el contenedor de Postgres | `postgres` |
| `POSTGRES_PASSWORD` | Contraseña de ese usuario | `postgres` |
| `POSTGRES_DB` | Base que se crea al inicializar el contenedor | `si_be_boilerplate` |
| `POSTGRES_PORT` | Puerto publicado en el host | `5432` |
| `DATABASE_URL` | Obligatoria. Cadena de conexión de Prisma. Dentro de Compose, `docker-compose.yml` la sobreescribe con el host `postgres` | `postgresql://postgres:postgres@localhost:5432/si_be_boilerplate?schema=public` |
| `JWT_SECRET` | Obligatoria. Secreto de firma del JWT, 32 caracteres o más | `cambiame-por-un-secreto-largo-y-aleatorio` |
| `JWT_EXPIRES_IN` | Vigencia del access token | `15m` |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | Vigencia del refresh token, en días | `7` |
| `BCRYPT_SALT_ROUNDS` | Costo de bcrypt para las contraseñas | `12` |
| `UPLOADS_DIR` | Carpeta de fotos y documentos (no se versiona) | `./uploads` |
| `SEED_LANDLORD_EMAIL` | Opcional en desarrollo, obligatoria en producción. Correo del ARRENDADOR que crea el seed | `arrendador@example.com` |
| `SEED_LANDLORD_PASSWORD` | Opcional en desarrollo, obligatoria en producción. Contraseña de ese ARRENDADOR | `Arrendador1234!` |
| `SEED_TENANT_EMAIL` | Opcional en desarrollo, obligatoria en producción. Correo del ARRENDATARIO que crea el seed | `arrendatario@example.com` |
| `SEED_TENANT_PASSWORD` | Opcional en desarrollo, obligatoria en producción. Contraseña de ese ARRENDATARIO | `Arrendatario1234!` |
| `SEED_REVIEWER_EMAIL` | Opcional en desarrollo, obligatoria en producción. Correo del REVISOR que crea el seed | `revisor@example.com` |
| `SEED_REVIEWER_PASSWORD` | Opcional en desarrollo, obligatoria en producción. Contraseña de ese REVISOR | `Revisor1234!` |

Fuera de `.env.example`:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `TEST_DATABASE_URL` | Opcional. Base de las pruebas e2e; su nombre debe terminar en `_test` (ver abajo) | `postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public` |
| `API_URL` | Frontend, en `.env.local`: URL del backend con el prefijo de versión | `http://localhost:3000/api/v1` |

## Pruebas automatizadas

```
npm test
npm run test:e2e
```

- **`npm test`** corre las pruebas unitarias con Vitest: los archivos
  `*.spec.ts`, junto al código en `src/` (por ejemplo
  `src/payments/services/pagos.service.spec.ts`) y en `test/contratos/`.
  No necesitan base de datos.
- **`npm run test:e2e`** corre los archivos `*.e2e-spec.ts` de `test/`
  (`vitest.config.e2e.ts`): una prueba de flujo y una de restricciones
  (`*.constraints.e2e-spec.ts`) por módulo, y las de QA por historia en
  `test/qa/qa-XX.Y-<historia>.e2e-spec.ts`. Montan la app completa contra
  PostgreSQL.

**Regla de las bases `_test`.** Las pruebas e2e nunca tocan la base de
desarrollo. El helper `test/helpers/test-database.ts` decide la base así:

- Si existe `TEST_DATABASE_URL`, usa esa URL tal cual: tiene que apuntar ya a
  una base cuyo nombre termina en `_test`, sin repetir el sufijo
  (`.../si_be_boilerplate_test`, no `.../si_be_boilerplate_test_test`).
- Si no existe, toma `DATABASE_URL` y le agrega `_test` al nombre de la base.
- En los dos casos se niega a correr si el nombre no termina en `_test` o si
  el host no es `localhost` o `127.0.0.1`.

La base de pruebas necesita las migraciones antes de la primera corrida:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" npx prisma migrate deploy
npm run test:e2e
```

En el frontend, `npm test` corre las pruebas de componentes, route handlers y
reglas (`__tests__/` de cada carpeta) con Vitest y Testing Library.
