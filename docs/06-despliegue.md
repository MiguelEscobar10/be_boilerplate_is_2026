# Despliegue

Resumen de [despliegue.md](despliegue.md), que tiene los comandos completos,
lo que se probó y los puntos que no hay que olvidar. La configuración está
probada con Docker (`docker-compose.demo.yml`, MP4-131), y la demo publicada
corre en Render con los `Dockerfile` de cada repositorio.

## Dónde está desplegado

| Componente | Plataforma | URL | Rama |
|---|---|---|---|
| Frontend | Render, Web Service con Docker (plan gratis, Oregon) | https://mp4-frontend.onrender.com | `main` |
| Backend | Render, Web Service con Docker (plan gratis, Oregon) | API: https://mp4-backend-4ua0.onrender.com/api/v1 · Swagger: https://mp4-backend-4ua0.onrender.com/api/docs | `main` |
| Base de datos | Render PostgreSQL 18 (plan gratis, Oregon) | (privada; el backend la usa por la red interna de Render) | |

Las dos URLs públicas tienen HTTPS (Render lo pone solo) y Swagger es público.
No hace falta CORS: el navegador nunca llama al backend directo, todo pasa por
las rutas del servidor de Next (route handlers y server actions).

Limitaciones del plan gratis de Render, que no afectan la defensa:

- Los servicios se duermen sin uso; la primera visita tarda unos 50 segundos.
- No hay disco persistente: las fotos y los documentos subidos se pierden
  cuando el backend se reinicia o se vuelve a desplegar.
- La base gratis vence el 20 de diciembre de 2026.

Hay dos formas preparadas. En una máquina con Docker, todo corre con
`docker-compose.demo.yml`: el frontend queda en el puerto 8080, el backend en
el 3000 y PostgreSQL 18 sin puerto publicado, con los volúmenes `pgdata` y
`uploads`. En una plataforma administrada, el backend y el frontend se
construyen desde el `Dockerfile` de cada repositorio, con una base
PostgreSQL 18 administrada y un disco persistente en `/app/uploads`.

## Cómo se publica una nueva versión

Procedimiento acordado para la versión 1.0.0. **Todavía no se ha hecho**: no
existen la rama `release/1.0.0`, la etiqueta `v1.0.0` ni el release en
ninguno de los dos repositorios.

1. En cada repositorio (backend y frontend), crear `release/1.0.0` desde
   `main` actualizado, abrir un PR de `release/1.0.0` hacia `main` con
   revisión de otro integrante y fusionarlo. Después, etiquetar el commit de
   `main` con `v1.0.0` (`git tag v1.0.0` y `git push origin v1.0.0`) y crear
   el release en GitHub desde esa etiqueta.
2. Actualizar la demo. Con Docker, en la máquina de la demo:

   ```bash
   git -C ../fe_boilerplate_is_2026 pull && git pull
   docker compose -f docker-compose.demo.yml --env-file .env.demo up -d --build
   ```

   El backend aplica las migraciones pendientes al arrancar
   (`npx prisma migrate deploy && node dist/main.js`). El seed se corre una
   sola vez, desde el servicio del backend: `npx prisma db seed`.

   En Render los dos servicios tienen el despliegue automático al hacer
   commit en `main`; si no arranca solo, se dispara en cada servicio con
   *Manual Deploy → Deploy latest commit*. Render ejecuta el *Docker Command*
   sin shell, así que no se puede encadenar con `&&`: el backend arranca con
   `node dist/main.js`. Cuando entra una migración nueva, se cambia el
   *Docker Command* a `npx prisma migrate deploy`, se despliega, y se vuelve a
   `node dist/main.js`. El seed se corrió igual, una vez, con
   `npx prisma db seed`.

## Variables de entorno en producción

| Variable | Dónde se configura |
|---|---|
| `NODE_ENV` (`production`) | Backend. Ya la fija `docker-compose.demo.yml`; en una plataforma, en sus variables |
| `DATABASE_URL` | Backend. La arma `docker-compose.demo.yml` con las `POSTGRES_*`; en una plataforma, la de su base administrada |
| `JWT_SECRET` | Backend. `.env.demo` o las variables o secretos de la plataforma |
| `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN_DAYS`, `BCRYPT_SALT_ROUNDS` | Backend, opcionales. `.env.demo` o la plataforma |
| `UPLOADS_DIR` (`/app/uploads`) | Backend. Ya la fija `docker-compose.demo.yml`; en una plataforma, en sus variables |
| `SEED_LANDLORD_EMAIL`, `SEED_LANDLORD_PASSWORD`, `SEED_TENANT_EMAIL`, `SEED_TENANT_PASSWORD`, `SEED_REVIEWER_EMAIL`, `SEED_REVIEWER_PASSWORD` | Backend, obligatorias para el seed (una cuenta por rol). `.env.demo` o la plataforma |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Base de la demo con Docker. `.env.demo` |
| `API_PORT`, `WEB_PORT`, `FRONTEND_DIR` | Demo con Docker. `.env.demo` |
| `API_URL` | Frontend. La fija `docker-compose.demo.yml` (`http://api:3000/api/v1`); en una plataforma, la URL pública del backend con `/api/v1` |

`.env.demo` se crea copiando [`.env.demo.example`](../.env.demo.example) y no
se sube al repositorio. Los valores reales nunca van en el README ni en estos
documentos. En la demo publicada están cargadas como variables de entorno de
cada servicio en Render (*mp4-backend* y *mp4-frontend* → Environment);
`JWT_SECRET` y las tres contraseñas del seed las generó Render. El seed creó
`arrendador@mmitas-demo.com`, `arrendatario@mmitas-demo.com` y
`revisor@mmitas-demo.com`; las contraseñas se pasan a la cátedra por un canal
privado.
