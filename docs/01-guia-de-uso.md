# Guía de uso

Plataforma de renta de equipos y espacios (Proyecto 4). Un arrendador publica
equipos o espacios; un arrendatario los busca, solicita la reserva, paga
(simulado), recibe el bien, lo devuelve y califica. Un revisor valida los
documentos de identidad.

Las rutas de esta guía son las del frontend
([fe_boilerplate_is_2026](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026)).
El detalle técnico de cada flujo está en el documento de su módulo en
[`modulos/`](modulos/).

## Roles

| Rol | Qué puede hacer |
|---|---|
| ARRENDADOR | Se registra solo en `/registro/arrendador`. Publica equipos o espacios, bloquea fechas de sus bienes, activa «requiere verificación», aprueba o rechaza solicitudes, registra la entrega y la devolución, resuelve la garantía, califica al arrendatario, conversa en las reservas de sus bienes y ve sus reportes de ingresos y de ocupación. |
| ARRENDATARIO | Se registra solo en `/registro/arrendatario`. Busca y filtra el catálogo, pregunta al arrendador antes de reservar, solicita reservas, paga las suyas, envía su documento de identidad, conversa en sus reservas y califica el bien y al arrendador. |
| REVISOR | No se puede registrar: solo existe si lo crea el seed (`npm run db:seed`). Revisa los documentos de identidad y aprueba o rechaza las verificaciones. |

Los tres roles ven el catálogo y sus propias notificaciones. El rol lo decide
el backend leyendo la base en cada petición: con un rol que no corresponde
responde 403, y un recurso ajeno responde 404 (ver
[cuentas](modulos/cuentas.md)).

Tabla de permisos (sección 2.1 del documento de historias):

| Acción | Sin sesión | Arrendatario | Arrendador | Revisor |
|---|---|---|---|---|
| Registrarse e iniciar sesión | Sí | No | No | No |
| Ver catálogo, detalle y disponibilidad de una publicación activa (H02, H11, H12, H13) | Sí | Sí | Sí | Sí |
| Publicar un equipo o espacio (H01) | No | No | Sí | No |
| Bloquear fechas de un bien propio (H14) | No | No | Sí | No |
| Activar «requiere verificación» en un bien propio (H19) | No | No | Sí | No |
| Solicitar una reserva (H03) | No | Sí | No | No |
| Aprobar o rechazar solicitudes de bienes propios (H04) | No | No | Sí | No |
| Pagar una reserva propia CONFIRMADA y consultar su pago (H05, H06) | No | Sí | No | No |
| Registrar entrega, devolución y resolver la garantía de bienes propios (H08, H09) | No | No | Sí | No |
| Preguntar al arrendador desde el detalle (H15) | No | Sí | No | No |
| Escribir y leer mensajes de una conversación propia (H15, H16) | No | Sí | Sí | No |
| Calificar el bien y al arrendador de una reserva propia COMPLETADA (H17) | No | Sí | No | No |
| Calificar al arrendatario de una reserva COMPLETADA de un bien propio (H18) | No | No | Sí | No |
| Enviar un documento de verificación propio (H07) | No | Sí | No | No |
| Revisar documentos y decidir verificaciones (H07) | No | No | No | Sí |
| Consultar y marcar como leídas las notificaciones propias (H10) | No | Sí | Sí | Sí |
| Ver ingresos y tasa de ocupación de bienes propios (H21, H22) | No | No | Sí | No |

En el backend, el catálogo, el detalle y la disponibilidad son públicos; en el
frontend esas pantallas todavía piden sesión (ver
[problemas conocidos](09-problemas-conocidos.md)).

## Flujos principales

### Módulo 0: Cuentas y roles

#### Registrarse e iniciar sesión

1. Abrir `/login` y usar el enlace de registro de arrendador o de
   arrendatario (`/registro/arrendador` o `/registro/arrendatario`).
2. Completar correo, contraseña (8 a 72 caracteres, con minúscula, mayúscula
   y número), nombre (hasta 100 caracteres) y teléfono (8 a 15 dígitos).
3. Pulsar «Crear cuenta». Si el correo ya existe se muestra «Ya existe una
   cuenta con ese correo»; si todo está bien, la sesión se inicia sola y el
   inicio (`/`) saluda con el nombre y el rol.
4. Las siguientes veces se entra desde `/login` con correo y contraseña.
   «Cerrar sesión» está en el encabezado.

### Módulo 1: Catálogo

#### Publicar un equipo o espacio (H01)

1. Entrar como ARRENDADOR y pulsar «Publicar un equipo o espacio» en el inicio
   (`/publicaciones/nueva`).
2. Elegir el tipo (EQUIPO o ESPACIO) y escribir nombre, descripción,
   ubicación, tarifa con su unidad (hora, día, noche o semana), depósito y
   condiciones.
3. Agregar de 1 a 10 fotos JPG o PNG de hasta 5 MB. La primera es la portada.
4. Pulsar «Guardar». Si falta algo, el error sale debajo del campo y
   no se envía nada.
5. Al guardarse, se abre el detalle de la publicación con el aviso de que
   quedó registrada.

#### Ver el detalle de una publicación (H12)

1. Desde el catálogo, abrir una tarjeta (`/publicaciones/{id}`).
2. El detalle muestra fotos, descripción, ubicación, tarifa con su unidad,
   depósito, condiciones y los promedios de calificaciones.
3. Debajo están la disponibilidad con el formulario de solicitud, «Bloquear
   fechas» (solo para el dueño) y «Contactar al arrendador».

### Módulo 2: Búsqueda y filtros

#### Buscar y filtrar (H02, H11)

1. Pulsar «Buscar equipos y espacios» en el inicio (`/publicaciones`).
2. Escribir una palabra clave y pulsar «Buscar» (o Enter). La búsqueda no
   distingue tildes ni mayúsculas.
3. En el panel de filtros elegir tipo, ubicación, precio mínimo y máximo y,
   si hace falta, fecha de inicio y de fin para ver solo lo disponible. Pulsar
   «Aplicar filtros».
4. Cada filtro aplicado aparece como etiqueta; se quita uno con su botón o
   todos con «Limpiar filtros».
5. Los resultados se recorren de 12 en 12 con «Anterior» y «Siguiente».

### Módulo 3: Reservas y disponibilidad

#### Bloquear fechas de un bien propio (H14)

1. Como ARRENDADOR, abrir el detalle de una publicación propia y pulsar
   «Bloquear fechas» (`/arrendador/publicaciones/{id}/bloqueos`).
2. Elegir el rango en el calendario y, si se quiere, escribir el motivo.
3. Guardar. El bloqueo aparece en la lista y esas fechas salen ocupadas para
   los demás.

#### Solicitar una reserva (H03, H13)

1. Como ARRENDATARIO, abrir el detalle de una publicación.
2. En el calendario de disponibilidad elegir el período (no deja elegir días
   pasados ni ocupados). Con tarifa por hora, elegir también la hora de inicio
   y de fin.
3. Revisar el resumen: costo estimado y depósito por separado.
4. Pulsar «Solicitar reserva». Se muestra «Enviamos tu solicitud
   al arrendador», con el estado PENDIENTE y el enlace «Ver mi solicitud»
   (`/reservas/{id}`).
5. Si la publicación exige verificación y la cuenta no está verificada, se
   muestra el motivo y un enlace a `/verificacion`.

#### Aprobar o rechazar una solicitud (H04)

1. Como ARRENDADOR, pulsar «Mis solicitudes» en el inicio
   (`/arrendador/solicitudes?estado=PENDIENTE`).
2. La tabla muestra arrendatario, bien, fechas, costo estimado y estado. Se
   puede filtrar por estado.
3. En una solicitud PENDIENTE, pulsar «Aprobar» o «Rechazar».
4. Confirmar. Al rechazar se puede escribir un motivo de hasta 500
   caracteres.
5. La fila se actualiza con el estado nuevo y el arrendatario recibe el aviso.
   Si las fechas ya se ocuparon con otra reserva, se explica el conflicto.

### Módulo 4: Pagos y garantía

#### Pagar una reserva (pago simulado, H05, H06)

1. Como ARRENDATARIO, abrir el detalle de una reserva CONFIRMADA
   (`/reservas/{id}`) y pulsar «Pagar reserva» (`/reservas/{id}/pago`).
2. Revisar el resumen: alquiler, depósito y total. La pantalla indica en todo
   momento que el pago es simulado y no hace cargos reales.
3. Escribir una tarjeta de prueba: terminada en **4242** aprueba y en **0002**
   rechaza. Cualquier otra se rechaza sin contar como intento.
4. Pulsar «Pagar». Tras unos 2 segundos se ve el resultado: aprobado con el
   total cobrado, o rechazado con el motivo y los intentos que quedan (hasta
   3 por reserva).
5. El estado del último pago queda visible en el detalle de la reserva.

#### Registrar la entrega (H08)

1. Como ARRENDADOR, abrir `/reservas/{id}/entrega` de una reserva CONFIRMADA
   de un bien propio. Hoy hay que escribir la URL: el enlace va en el detalle
   de las reservas CONFIRMADAS de «Mis solicitudes» (`AccionEntrega`) y está
   pendiente desde el PR #10 del frontend (ver
   [problemas conocidos](09-problemas-conocidos.md)).
2. Escribir la nota del estado inicial (hasta 500 caracteres) y agregar hasta
   5 fotos JPG o PNG de 5 MB como máximo.
3. Confirmar. Se muestra «Entrega registrada. La reserva pasó a EN_CURSO.».
   Antes de la fecha de inicio la pantalla dice desde cuándo se podrá
   registrar.
4. El arrendador y el arrendatario ven después el detalle de la entrega con
   sus fotos, sin formulario.

#### Registrar la devolución y resolver la garantía (H09)

1. Como ARRENDADOR, abrir la reserva desde «Mis solicitudes» y entrar a
   `/reservas/{id}/devolucion`.
2. Registrar la devolución: fecha y hora real, estado final («Sin
   observaciones» o «Con observaciones») y, si hay observaciones, los daños o
   faltantes. La reserva sigue EN_CURSO.
3. Resolver el depósito: escribir cuánto se retiene (con motivo si es más de
   0) y revisar el depósito original, el retenido y el liberado.
4. Confirmar. La reserva pasa a COMPLETADA y el arrendatario recibe el aviso.
   El arrendatario ve la misma pantalla sin acciones.

### Módulo 5: Mensajería

#### Preguntar antes de reservar (H15)

1. Como ARRENDATARIO, abrir el detalle de una publicación y pulsar
   «Contactar al arrendador».
2. Escribir el mensaje (hasta 1000 caracteres) y enviarlo.
3. El arrendador recibe el aviso «Mensaje nuevo» y responde en la misma
   conversación.

#### Conversar sobre una reserva (H16)

1. El arrendatario o el arrendador abren `/reservas/{id}/conversacion`.
2. Con la reserva CONFIRMADA o EN_CURSO se ve el historial y la caja para
   escribir; pulsar «Actualizar» trae los mensajes nuevos.
3. Con la reserva PENDIENTE la conversación todavía no se habilita; con la
   reserva RECHAZADA, CANCELADA o COMPLETADA solo se lee el historial.

### Módulo 6: Reseñas

#### Calificar el bien y al arrendador (H17)

1. Como ARRENDATARIO, abrir el detalle de una reserva COMPLETADA
   (`/reservas/{id}`).
2. En la sección «Calificación», pulsar «Calificar».
3. Elegir de 1 a 5 estrellas para el bien y para el arrendador y, si se
   quiere, escribir un comentario de hasta 500 caracteres.
4. Enviar. La sección muestra lo guardado y ya no ofrece calificar otra vez.

#### Calificar al arrendatario (H18)

1. Como ARRENDADOR, abrir `/arrendador/solicitudes?estado=COMPLETADA`.
2. En una reserva sin calificar, pulsar «Calificar al arrendatario».
3. Elegir de 1 a 5 estrellas y, si se quiere, escribir un comentario.
4. Enviar. La fila pasa a «Ya calificado ✓».

### Módulo 7: Verificación de identidad

#### Enviar el documento (H07)

1. Como ARRENDATARIO, abrir `/verificacion` (también se llega desde el aviso
   de una publicación que exige verificación).
2. Subir un documento JPG, PNG o PDF de hasta 5 MB y enviarlo.
3. La pantalla pasa a «En revisión». Mientras haya una solicitud pendiente no
   se puede enviar otra.
4. Al volver, se ve «Identidad verificada» o «Verificación rechazada» con el
   motivo y el formulario para reenviar.

#### Revisar documentos (H07)

1. Como REVISOR, abrir `/verificacion/revision`.
2. La cola muestra las solicitudes PENDIENTE en orden de llegada.
3. Abrir el documento de una solicitud.
4. Aprobar, o rechazar con un motivo opcional de hasta 500 caracteres.

#### Exigir verificación en una publicación (H19)

1. Como ARRENDADOR, activar «requiere verificación» en una publicación propia
   con `PATCH /api/v1/publicaciones/{id}/requiere-verificacion`. El
   frontend ya tiene el interruptor (`InterruptorRequiereVerificacion`), pero
   ninguna pantalla lo muestra todavía (ver
   [problemas conocidos](09-problemas-conocidos.md)).
2. Desde ese momento, solo los arrendatarios con la identidad APROBADA pueden
   solicitarla. A los demás, al pulsar «Solicitar reserva», se les muestra el
   motivo y el enlace a `/verificacion`.

### Módulo 8: Notificaciones

#### Consultar los avisos (H10, H20)

1. Con cualquier rol, la campana del encabezado muestra cuántos avisos no
   leídos hay. El contador se actualiza cada 30 segundos.
2. Pulsar la campana para abrir la bandeja: los más recientes primero, con
   los pendientes resaltados.
3. Filtrar por «No leídas» si se quiere.
4. Pulsar «Marcar como leída» en un aviso; el contador baja.
5. Pulsar «Actualizar» para traer los avisos nuevos a la lista abierta.

Los avisos llegan por solicitud nueva, reserva confirmada o rechazada, pago
aprobado o rechazado, garantía resuelta y mensaje nuevo (catálogo en
[notificaciones](modulos/notificaciones.md)).

### Módulo 9: Reportes

#### Reporte de ingresos (H21)

1. Como ARRENDADOR, abrir `/ingresos`.
2. Elegir el rango de fechas.
3. Se ve el total y una tabla con el ingreso de cada bien en ese período.

#### Reporte de ocupación (H22)

1. Como ARRENDADOR, abrir `/reportes/ocupacion`.
2. Por defecto se ve el mes en curso; se puede elegir otro rango de hasta 366
   días.
3. La tabla muestra por bien los días ocupados, los días disponibles y la
   tasa de ocupación con un decimal (un bien sin reservas sale con 0.0 %).
