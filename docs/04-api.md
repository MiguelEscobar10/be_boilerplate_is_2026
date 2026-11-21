# API

**Documentación interactiva (Swagger):** https://mp4-backend-4ua0.onrender.com/api/docs (pública). En local:
`http://localhost:3000/api/docs`.

Todas las rutas cuelgan de `/api/v1`. El contrato completo de cada endpoint
(cuerpo, respuestas y errores) está en Swagger y en el documento de su módulo
en [`modulos/`](modulos/); las reglas comunes, en [endpoints.md](endpoints.md).

## Autenticación

1. **Obtener el token:** `POST /api/v1/auth/login` con
   `{ "email": "...", "password": "..." }`. Responde 200 con `accessToken`,
   `refreshToken`, `expiresIn` (en segundos) y `user`.
2. **Enviarlo:** en cada petición protegida, el encabezado
   `Authorization: Bearer <accessToken>`. En Swagger se carga con el botón
   «Authorize» (`addBearerAuth`).
3. **Duración:** el access token es un JWT HS256 que dura lo que diga
   `JWT_EXPIRES_IN` (por defecto `15m`, así que `expiresIn` es 900). El
   refresh token dura `REFRESH_TOKEN_EXPIRES_IN_DAYS` días (por defecto 7).
4. **Renovar y cerrar sesión:** `POST /api/v1/auth/refresh` con
   `{ "refreshToken": "..." }` devuelve un par nuevo y revoca el anterior; si
   llega un refresh token ya canjeado se revocan todas las sesiones del
   usuario. `POST /api/v1/auth/logout` lo revoca y responde 204.

Todo está cerrado por defecto: `JwtAuthGuard` es global y las rutas públicas
se abren con `@Public()`. Sin token o con uno inválido la respuesta es 401;
con un rol que no corresponde, 403 (`RolesGuard`, que lee el rol de la base en
cada petición); un recurso ajeno responde 404.

El frontend no usa el refresh token: cuando el access token vence, manda al
login.

### Diferencias con la sección 2.1 de la especificación

Son decisiones del equipo; el detalle está en
[decisiones técnicas](02-arquitectura.md#decisiones-técnicas).

| Especificación (sección 2.1) | Implementado | Motivo |
|---|---|---|
| Registro con `POST /api/v1/auth/registro` | `POST /api/v1/users`, el endpoint del boilerplate | Es el mismo recurso y así no hay dos formas de crear una cuenta. Se cumple el resto del contrato: un endpoint para las dos pantallas, `rol` solo ARRENDADOR o ARRENDATARIO y 400 `ROL_NO_PERMITIDO` para cualquier otro valor ([cuentas](modulos/cuentas.md)). |
| Token y rol en `localStorage` (clave `sesion`) | Token en la cookie httpOnly `session` del servidor de Next; los route handlers de Next lo reenvían como Bearer | El JavaScript del navegador no puede leer una cookie httpOnly, así que un script inyectado no roba el token. El rol no se guarda en el navegador: se pide con `GET /auth/me` (frontend, `docs/decisiones/manejo-de-estado.md`). |

## Endpoints por módulo

Verificados contra los controladores de `src/` (44 endpoints). En «Roles»,
«Pública» no pide token y «Con sesión» acepta cualquier rol autenticado (el
servicio igual revisa que el recurso sea propio).

### Módulo 0: Cuentas y roles

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/users | Registra una cuenta de arrendador o arrendatario | Pública |
| POST | /api/v1/auth/login | Inicia sesión con correo y contraseña | Pública |
| POST | /api/v1/auth/refresh | Renueva el access token rotando el refresh token | Pública |
| POST | /api/v1/auth/logout | Cierra la sesión revocando el refresh token | Pública |
| GET | /api/v1/auth/me | Devuelve el usuario autenticado, con rol, nombre y teléfono | Con sesión |

Detalle: [cuentas](modulos/cuentas.md).

### Módulos 1 y 2: Catálogo, búsqueda y filtros

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/publicaciones | Publica un equipo o espacio (multipart, con fotos) | ARRENDADOR |
| GET | /api/v1/publicaciones | Lista, busca y filtra publicaciones activas (`buscar`, `tipo`, `ubicacion`, `precioMin`, `precioMax`, `fechaInicio`, `fechaFin`, `page`, `limit`) | Pública |
| GET | /api/v1/publicaciones/{id} | Consulta una publicación | Pública |
| GET | /api/v1/publicaciones/{id}/imagenes/{orden} | Devuelve una foto de la publicación | Pública |

Detalle: [catalogo](modulos/catalogo.md).

### Módulo 3: Reservas y disponibilidad

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | /api/v1/publicaciones/{id}/disponibilidad | Períodos ocupados de una publicación en un rango de fechas | Pública |
| POST | /api/v1/publicaciones/{id}/bloqueos | Bloquea un rango de fechas de una publicación propia | ARRENDADOR |
| GET | /api/v1/publicaciones/{id}/bloqueos | Bloqueos de una publicación propia, con su motivo | ARRENDADOR |
| POST | /api/v1/reservas | Solicita una reserva | ARRENDATARIO |
| GET | /api/v1/reservas/{id} | Detalle de una reserva propia | Con sesión |
| GET | /api/v1/arrendador/solicitudes | Solicitudes de reserva de las publicaciones del arrendador | ARRENDADOR |
| PATCH | /api/v1/reservas/{id}/decision | Aprueba o rechaza una solicitud de reserva PENDIENTE | ARRENDADOR |

Detalle: [reservas](modulos/reservas.md).

### Módulo 4: Pagos y garantía

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/reservas/{id}/pagos/simulados | Paga una reserva confirmada con una tarjeta de prueba | ARRENDATARIO |
| GET | /api/v1/reservas/{id}/pagos/ultimo | Consulta el último pago de una reserva propia | ARRENDATARIO |
| POST | /api/v1/reservas/{id}/entrega | Registra la entrega y pasa la reserva a EN_CURSO | ARRENDADOR |
| GET | /api/v1/reservas/{id}/entrega | Consulta la entrega de una reserva propia | Con sesión |
| GET | /api/v1/reservas/{id}/entrega/fotos/{orden} | Devuelve una foto del estado inicial | Con sesión |
| POST | /api/v1/reservas/{id}/devolucion | Registra la devolución de una reserva EN_CURSO | ARRENDADOR |
| GET | /api/v1/reservas/{id}/devolucion | Consulta la devolución de una reserva propia | Con sesión |
| POST | /api/v1/reservas/{id}/deposito/resolucion | Resuelve la garantía y pasa la reserva a COMPLETADA (simulado) | ARRENDADOR |
| GET | /api/v1/reservas/{id}/deposito/resolucion | Consulta el estado de la garantía de una reserva propia | Con sesión |

Detalle: [pagos](modulos/pagos.md), [entregas](modulos/entregas.md) y
[devoluciones](modulos/devoluciones.md).

### Módulo 5: Mensajería

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/publicaciones/{id}/conversaciones | Abre (o reutiliza) la conversación con el arrendador | ARRENDATARIO |
| POST | /api/v1/reservas/{id}/conversacion | Abre (o recupera) la conversación de la reserva | ARRENDATARIO, ARRENDADOR |
| POST | /api/v1/conversaciones/{id}/mensajes | Envía un mensaje en una conversación propia | ARRENDATARIO, ARRENDADOR |
| GET | /api/v1/conversaciones/{id}/mensajes | Historial de una conversación propia, en orden cronológico | ARRENDATARIO, ARRENDADOR |

Detalle: [mensajeria](modulos/mensajeria.md).

### Módulo 6: Reseñas

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/reservas/{id}/calificacion | Califica el bien y al arrendador de una reserva COMPLETADA | ARRENDATARIO |
| GET | /api/v1/reservas/{id}/calificacion | Consulta la calificación que dejó en una reserva propia | ARRENDATARIO |
| POST | /api/v1/reservas/{id}/calificacion-arrendatario | Califica al arrendatario de una reserva COMPLETADA | ARRENDADOR |

Detalle: [resenas](modulos/resenas.md).

### Módulo 7: Verificación de identidad

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| POST | /api/v1/usuarios/me/verificaciones | Envía el documento de identidad para revisión | ARRENDATARIO |
| GET | /api/v1/usuarios/me/verificaciones/ultima | Consulta el estado de la última solicitud propia | ARRENDATARIO |
| GET | /api/v1/verificaciones | Lista las solicitudes de un estado (por defecto, PENDIENTE) | REVISOR |
| GET | /api/v1/verificaciones/{id}/documento | Abre el documento de una solicitud | REVISOR |
| PATCH | /api/v1/verificaciones/{id}/decision | Aprueba o rechaza una solicitud PENDIENTE | REVISOR |
| PATCH | /api/v1/publicaciones/{id}/requiere-verificacion | Activa o desactiva «requiere verificación» en una publicación propia | ARRENDADOR |

Detalle: [verificacion](modulos/verificacion.md).

### Módulo 8: Notificaciones

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | /api/v1/notificaciones | Lista la bandeja del usuario, más recientes primero | Con sesión |
| GET | /api/v1/notificaciones/no-leidas/conteo | Cuenta las notificaciones no leídas | Con sesión |
| PATCH | /api/v1/notificaciones/{id}/leida | Marca como leída una notificación propia | Con sesión |

Los avisos se registran desde el backend con `AvisosService`; no hay ruta
HTTP para crearlos ([contrato](contratos/servicio-avisos.md),
[notificaciones](modulos/notificaciones.md)).

### Módulo 9: Reportes

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | /api/v1/reportes/ingresos | Ingresos por bien del arrendador en un período | ARRENDADOR |
| GET | /api/v1/reportes/ocupacion | Tasa de ocupación de los bienes del arrendador en un período | ARRENDADOR |

Detalle: [ingresos](modulos/ingresos.md) y [reportes](modulos/reportes.md).

### Salud

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | /api/v1/ | Health check | Pública |
