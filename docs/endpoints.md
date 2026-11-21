# Resumen de endpoints

Generado de los controladores de `src/` el 20 de noviembre de 2026, con `main`
en `0fb492f`. El contrato completo de cada uno (cuerpo, respuestas y errores)
está en Swagger, en `/api/docs` con la API corriendo, y en el documento de cada
módulo en [`modulos/`](modulos/).

## Reglas comunes

- **Prefijo:** todas las rutas cuelgan de `/api/v1`.
- **Autenticación:** `Authorization: Bearer <accessToken>`, que se obtiene con
  `POST /auth/login`. Las rutas marcadas "pública" no lo piden.
- **Roles:** los decide el backend leyendo la base en cada petición
  (`JwtAuthGuard` y luego `RolesGuard` con `@Roles`). Con un rol que no
  corresponde la respuesta es **403**.
- **Recursos ajenos:** responden **404**, igual que si no existieran, para no
  revelar que existen.
- **Validación:** `ValidationPipe` con `whitelist` y `forbidNonWhitelisted`:
  un campo que no está en el contrato es **400**.
- **Errores:** el cuerpo de Nest (`statusCode`, `message`, `error`). Cuando
  hay que distinguir el motivo de un 409, se agrega `codigo` (por ejemplo
  `CONVERSACION_CERRADA` o los de pagos).

## Endpoints

"Quién" es el rol exigido; "con sesión" significa cualquier usuario autenticado
(el servicio igual revisa que el recurso sea suyo).

| Módulo | Método | Ruta | Quién | Para qué |
|---|---|---|---|---|
| Salud | GET | `/api/v1/` | pública | Health check |
| Cuentas | POST | `/api/v1/users` | pública | Registra una cuenta de arrendador o arrendatario |
| Cuentas | POST | `/api/v1/auth/login` | pública | Inicia sesión con correo y contraseña |
| Cuentas | POST | `/api/v1/auth/refresh` | pública | Renueva el access token rotando el refresh token |
| Cuentas | POST | `/api/v1/auth/logout` | pública | Cierra la sesión revocando el refresh token |
| Cuentas | GET | `/api/v1/auth/me` | con sesión | Devuelve el usuario autenticado |
| Catálogo (M1) | POST | `/api/v1/publicaciones` | ARRENDADOR | Publica un equipo o espacio |
| Búsqueda y filtros (M2) | GET | `/api/v1/publicaciones` | pública | Lista, busca y filtra publicaciones activas |
| Catálogo (M1) | GET | `/api/v1/publicaciones/{id}` | pública | Consulta el detalle completo de una publicación |
| Catálogo (M1) | GET | `/api/v1/publicaciones/{id}/imagenes/{orden}` | pública | Devuelve una foto de la publicación |
| Reservas y disponibilidad (M3) | GET | `/api/v1/publicaciones/{id}/disponibilidad` | pública | Períodos ocupados de una publicación en un rango de fechas |
| Reservas y disponibilidad (M3) | POST | `/api/v1/publicaciones/{id}/bloqueos` | ARRENDADOR | Bloquea un rango de fechas de una publicación propia |
| Reservas y disponibilidad (M3) | GET | `/api/v1/publicaciones/{id}/bloqueos` | ARRENDADOR | Bloqueos de una publicación propia, con su motivo |
| Reservas y disponibilidad (M3) | POST | `/api/v1/reservas` | ARRENDATARIO | Solicita una reserva: queda PENDIENTE, con el costo calculado por el servidor |
| Reservas y disponibilidad (M3) | GET | `/api/v1/reservas/{id}` | con sesión | Detalle de una reserva propia (del arrendatario o del dueño de la publicación) |
| Reservas y disponibilidad (M3) | GET | `/api/v1/arrendador/solicitudes` | ARRENDADOR | Solicitudes de reserva de las publicaciones del arrendador |
| Reservas y disponibilidad (M3) | PATCH | `/api/v1/reservas/{id}/decision` | ARRENDADOR | Aprueba o rechaza una solicitud de reserva PENDIENTE |
| Pagos (M4) | POST | `/api/v1/reservas/{id}/pagos/simulados` | ARRENDATARIO | Paga una reserva confirmada con una tarjeta de prueba |
| Pagos (M4) | GET | `/api/v1/reservas/{id}/pagos/ultimo` | ARRENDATARIO | Consulta el último pago de una reserva propia |
| Pagos (M4) | POST | `/api/v1/reservas/{id}/entrega` | ARRENDADOR | Registra la entrega y pasa la reserva a EN_CURSO |
| Pagos (M4) | GET | `/api/v1/reservas/{id}/entrega` | con sesión | Consulta la entrega de una reserva propia |
| Pagos (M4) | GET | `/api/v1/reservas/{id}/entrega/fotos/{orden}` | con sesión | Devuelve una foto del estado inicial |
| Pagos (M4) | POST | `/api/v1/reservas/{id}/devolucion` | ARRENDADOR | Registra la devolución de una reserva EN_CURSO |
| Pagos (M4) | GET | `/api/v1/reservas/{id}/devolucion` | con sesión | Consulta la devolución de una reserva propia |
| Pagos (M4) | POST | `/api/v1/reservas/{id}/deposito/resolucion` | ARRENDADOR | Resuelve la garantía y pasa la reserva a COMPLETADA (simulado) |
| Pagos (M4) | GET | `/api/v1/reservas/{id}/deposito/resolucion` | con sesión | Consulta el estado de la garantía de una reserva propia |
| Mensajería (M5) | POST | `/api/v1/publicaciones/{id}/conversaciones` | ARRENDATARIO | Abre (o reutiliza) la conversación con el arrendador |
| Mensajería (M5) | POST | `/api/v1/reservas/{id}/conversacion` | ARRENDATARIO, ARRENDADOR | Abre (o recupera) la conversación de la reserva |
| Mensajería (M5) | POST | `/api/v1/conversaciones/{id}/mensajes` | ARRENDATARIO, ARRENDADOR | Envía un mensaje en una conversación propia |
| Mensajería (M5) | GET | `/api/v1/conversaciones/{id}/mensajes` | ARRENDATARIO, ARRENDADOR | Historial de una conversación propia, en orden cronológico |
| Reseñas (M6) | POST | `/api/v1/reservas/{id}/calificacion` | ARRENDATARIO | Califica el bien y al arrendador de una reserva COMPLETADA |
| Reseñas (M6) | GET | `/api/v1/reservas/{id}/calificacion` | ARRENDATARIO | Consulta la calificación que dejaste en una reserva propia |
| Reseñas (M6) | POST | `/api/v1/reservas/{id}/calificacion-arrendatario` | ARRENDADOR | Califica al arrendatario de una reserva COMPLETADA |
| Verificación (M7) | POST | `/api/v1/usuarios/me/verificaciones` | ARRENDATARIO | Envía el documento de identidad para revisión |
| Verificación (M7) | GET | `/api/v1/usuarios/me/verificaciones/ultima` | ARRENDATARIO | Consulta el estado de la última solicitud propia |
| Verificación (M7) | GET | `/api/v1/verificaciones` | REVISOR | Lista las solicitudes de un estado (por defecto, PENDIENTE) |
| Verificación (M7) | GET | `/api/v1/verificaciones/{id}/documento` | REVISOR | Abre el documento de una solicitud |
| Verificación (M7) | PATCH | `/api/v1/verificaciones/{id}/decision` | REVISOR | Aprueba o rechaza una solicitud PENDIENTE |
| Verificación (M7) | PATCH | `/api/v1/publicaciones/{id}/requiere-verificacion` | ARRENDADOR | Activa o desactiva "requiere verificación" en una publicación propia |
| Notificaciones (M8) | GET | `/api/v1/notificaciones` | con sesión | Lista la bandeja del usuario, más recientes primero |
| Notificaciones (M8) | GET | `/api/v1/notificaciones/no-leidas/conteo` | con sesión | Cuenta las notificaciones no leídas |
| Notificaciones (M8) | PATCH | `/api/v1/notificaciones/{id}/leida` | con sesión | Marca como leída una notificación propia |
| Reportes (M9) | GET | `/api/v1/reportes/ingresos` | ARRENDADOR | Ingresos por bien del arrendador en un período |
| Reportes (M9) | GET | `/api/v1/reportes/ocupacion` | ARRENDADOR | Tasa de ocupación de los bienes del arrendador en un período |

Total: 44 endpoints.
