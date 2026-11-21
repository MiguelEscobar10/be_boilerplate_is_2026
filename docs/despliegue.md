# Despliegue de la demo (MP4-131)

Cómo publicar la demo completa: base de datos, backend y frontend. La
configuración está probada con Docker. Falta elegir dónde alojarla y anotar
la URL en el README.

## Opción 1: una máquina con Docker (VPS o la de la cátedra)

Es la forma más directa: todo corre con `docker-compose.demo.yml` y los datos
quedan en volúmenes.

```bash
# Clonar los dos repositorios uno al lado del otro
git clone https://github.com/MiguelEscobar10/be_boilerplate_is_2026.git
git clone https://github.com/MiguelEscobar10/fe_boilerplate_is_2026.git
cd be_boilerplate_is_2026

# Variables: copiar la plantilla y cambiar TODOS los valores de ejemplo
cp .env.demo.example .env.demo
openssl rand -base64 48        # para JWT_SECRET
openssl rand -hex 24           # para POSTGRES_PASSWORD (solo letras y números)

# Construir y levantar (las migraciones corren solas al arrancar el backend)
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d --build

# Una sola vez: crear una cuenta por rol (ARRENDADOR, ARRENDATARIO y REVISOR)
docker compose -f docker-compose.demo.yml --env-file .env.demo exec api npx prisma db seed
```

Queda el frontend en `http://<servidor>:8080` y el backend en
`http://<servidor>:3000/api/v1` (Swagger en `/api/docs`). Para la cátedra
basta con dar la URL del frontend: el frontend llama al backend por la red
interna de Docker, así que el puerto del backend se puede cerrar si no hace
falta Swagger.

Para actualizar después de unir PR a `main`:

```bash
git -C ../fe_boilerplate_is_2026 pull && git pull
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d --build
```

### Qué se probó

**20 de noviembre de 2026**, con `main` del backend en `6d31f63`: en un
PostgreSQL 18 alpine nuevo se aplican las 23 migraciones (incluidas
`unaccent` y `pg_trgm`) y el seed crea el REVISOR.

**19 de noviembre de 2026**

con `main` del backend en `e82a9d7` y del frontend en `17687c6`:

- El backend aplica las 20 migraciones al arrancar y el seed crea el REVISOR;
  `POST /auth/login` del revisor responde 200.
- Desde el frontend (puerto 8080): registro de un arrendador, publicación con
  una foto y la foto se ve en el detalle.
- `docker compose down` y `up` otra vez: la publicación y la foto siguen ahí
  (volúmenes `pgdata` y `uploads`).

## Opción 2: plataformas administradas

Si no hay una máquina, cualquier plataforma que corra imágenes Docker sirve.
Lo que hay que configurar es lo mismo en todas:

| Servicio | Cómo | Variables |
|---|---|---|
| PostgreSQL 18 | Base administrada de la plataforma | Su `DATABASE_URL` (con `?schema=public`) |
| Backend | Imagen desde `Dockerfile` de este repo. Comando de inicio: `sh -c "npx prisma migrate deploy && node dist/main.js"` | `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (32+ caracteres), `UPLOADS_DIR=/app/uploads`, las seis `SEED_*` (`SEED_LANDLORD_*`, `SEED_TENANT_*` y `SEED_REVIEWER_*`, email y contraseña de cada una), y opcionales `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN_DAYS`, `BCRYPT_SALT_ROUNDS` |
| Volumen | **Disco persistente montado en `/app/uploads`** del backend | Sin él, las fotos y los documentos se pierden en cada despliegue |
| Frontend | Imagen desde `Dockerfile` del repo del frontend (`output: 'standalone'`) | `API_URL` = URL pública del backend con `/api/v1` |
| Seed | Una vez, desde la consola del servicio del backend: `npx prisma db seed` | Las seis `SEED_*` |

## Puntos que no hay que olvidar

- **Secretos:** `.env.demo` está en `.gitignore`. Nunca subir `JWT_SECRET`, la
  contraseña de la base ni las de las cuentas del seed. En la plataforma se cargan como
  variables o secretos.
- **`JWT_SECRET` y las seis `SEED_*` son obligatorias en producción:** el
  backend no arranca sin `JWT_SECRET` y el seed falla a propósito si falta
  alguna credencial (no se crea ninguna cuenta con contraseña por defecto, ni
  el `demo@example.com` del boilerplate).
- **La contraseña de la base va sin codificar dentro de `DATABASE_URL`:** que
  sea alfanumérica (`openssl rand -hex 24`). Con `-base64` puede traer `/`, `+`
  o `=` y la URL queda inválida.
- **Extensiones de PostgreSQL:** la migración de la búsqueda
  (`20261120051614_add_listing_search_indexes`) crea `unaccent` y `pg_trgm`.
  Con el compose no hay problema, porque `POSTGRES_USER` es superusuario y la
  imagen alpine trae las dos. En una base administrada hay que confirmar que el
  proveedor las permita antes de desplegar.
- **`npm ci` depende de la versión de npm:** con la imagen `node:24-alpine`
  funciona; con npm 10 (Node 22) falla por el lock (`Missing: typescript`).
  Si se cambia la imagen base o se instala fuera de Docker, usar Node 24.
- **El volumen de `/app/uploads`** es lo que más fácil se olvida en una
  plataforma administrada: sin él la demo parece funcionar hasta el siguiente
  despliegue.
- **El build del frontend descarga las fuentes de Google** (`next/font`), así
  que necesita salida a internet durante el build.
- **HTTPS:** las plataformas administradas lo dan solas. En una máquina propia,
  poner un proxy inverso (por ejemplo Caddy o nginx) delante del puerto 8080.
  La cookie de sesión se marca `secure` en producción, así que **el frontend
  necesita HTTPS** para que el login funcione fuera de `localhost`.

## Cuando esté publicada

1. Anotar la URL del frontend en el README de los dos repositorios (sección
   del proyecto) y, si se deja abierto, la de Swagger.
2. Pasar a la cátedra las tres cuentas del seed por un canal privado, no en el
   README.
3. Cerrar MP4-131 en Jira con la URL.
