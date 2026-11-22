# Plan de pruebas: H03, H06 y H17

Responsable: Mario Molina. Aceptación: Ricardo (pareja cruzada).
Historias: **H03. Solicitar una reserva**, **H06. Consultar el estado de un pago**
y **H17. Calificar el bien y al arrendador** (17 criterios en total).

Ambiente de las pruebas manuales: https://mp4-frontend.onrender.com, con el
arrendatario del seed. No se hizo redeploy ni merge a main.

## 1. Pruebas de componente (automatizadas)

Un `it('ACn: …')` por criterio. Backend: se renombraron los casos de las suites
QA que ya existían y se dejó el id original entre paréntesis. Frontend: un
archivo `hNN-plan-pruebas.test.tsx` por historia.

Backend, `npm run test:e2e -- qa-03.1 qa-06.1 qa-17.1`. Frontend, `npm test`.

| Criterio | Backend (archivo, caso) | Frontend | Resultado |
|---|---|---|---|
| H03 AC1 solicitud válida queda PENDIENTE | qa-03.1, S01 | h03, AC1 | Pasa |
| H03 AC2 el detalle trae estado, fechas, costo y depósito | qa-03.1, S17 | h03, AC2 | Pasa |
| H03 AC3 fin anterior o igual al inicio da 400 | qa-03.1, S10 | h03, AC3 | Pasa |
| H03 AC4 inicio ya pasado da 400 FECHA_PASADA | qa-03.1, S08 | h03, AC4 | Pasa |
| H03 AC5 periodo ocupado da 409 | qa-03.1, S03 | h03, AC5 | Pasa |
| H03 AC6 verificación requerida da 422 | qa-03.1, S20 | h03, AC6 | Pasa |
| H03 AC7 aviso «Nueva solicitud de reserva» | qa-03.1, S18 | no aplica (solo backend) | Pasa |
| H06 AC1 monto, fecha, reserva y estado del pago | qa-06.1, C01 | h06, AC1 | Pasa |
| H06 AC1 número de transacción (recibo) | qa-06.1, C01 (`pagoId`) | h06, AC1 [D1] | **Falla en la interfaz (D1)** |
| H06 AC2 se muestra el intento más reciente | qa-06.1, C02 | h06, AC2 | Pasa |
| H06 AC3 sin pago: «Aún no hay un pago registrado» | qa-06.1, C04 | h06, AC3 | Pasa |
| H06 AC4 reserva ajena: 404 sin datos | qa-06.1, C05 | h06, AC4 | Pasa |
| H17 AC1 puntajes 1 a 5 y comentario hasta 500 | qa-17.1, R01 | h17, AC1 | Pasa |
| H17 AC2 promedios con un decimal | qa-17.1, R10 | h17, AC2 | Pasa |
| H17 AC3 reserva no COMPLETADA da 422 | qa-17.1, R03 | h17, AC3 | Pasa |
| H17 AC4 ya calificada da 409 | qa-17.1, R04 | h17, AC4 | Pasa |
| H17 AC5 reserva ajena da 404 | qa-17.1, R06 | h17, AC5 | Pasa |
| H17 AC6 puntajes o comentario inválidos dan 400 | qa-17.1, R07 | h17, AC6 | Pasa |

Casos negativos (al menos uno por historia, ya incluidos en las suites):
H03 en S14 a S16 y S19 (sin sesión o arrendador, publicación inexistente,
reserva ajena, solicitud rechazada sin aviso); H06 en C03, C06, C09 y C11
(motivo solo si se rechaza, accesos, consultar no crea pagos, sin datos de
tarjeta); H17 en R05, R08, R11 y R13 (envíos simultáneos, permisos, un rechazo
no cambia el promedio, segunda calificación en la base).

Resultado: backend 66/66 en las tres suites; frontend 593 pasan y 1 fallo
esperado (`it.fails`, defecto D1).

## 2. Casos manuales de integración (CP-301 en adelante)

Evidencia en `docs/qa/evidencias/plan-H03-H06-H17/`.

| Id | Criterio | Pasos | Esperado | Resultado |
|---|---|---|---|---|
| CP-301 | H03 AC1, AC2 | Arrendatario: abrir el Taladro percutor, elegir 25 y 26 nov, «Solicitar reserva» | Solicitud PENDIENTE; período 25 nov 00:00 – 27 nov 00:00; alquiler $16.00 (2 días × $8.00); depósito $20.00 aparte | **Pasa.** Solicitud `1bd25f9a-b092-4c30-b623-58dd816ff432`. Capturas `CP-301-*.png` |
| CP-302 | H03 AC3 | Elegir un último día anterior al primero | No se forma un periodo inválido | Pendiente |
| CP-303 | H03 AC4 | Mirar los días anteriores a hoy en el calendario | Aparecen como «pasado» y no se pueden elegir | **Pasa**, visto en la captura de CP-301 |
| CP-304 | H03 AC5 | Mirar el 22 y 23 nov del taladro (reserva confirmada) | Aparecen como ocupados y no se pueden elegir | **Pasa**, visto en la captura de CP-301 |
| CP-305 | H03 AC6 | Con un arrendatario sin verificar, solicitar un bien que la exige | Aviso de verificación con enlace a /verificacion; no se crea la solicitud | Pendiente (falta cuenta sin verificar) |
| CP-306 | H03 AC7 | Arrendador: abrir la bandeja tras CP-301 | Aviso «Nueva solicitud de reserva» con el bien y las fechas | Pendiente |
| CP-307 | H03 negativo | Doble clic en «Solicitar reserva» | Una sola solicitud | Pendiente |
| CP-308 | H03 negativo | Sin sesión, abrir una publicación y solicitar | Redirige al login | Pendiente |
| CP-311 | H06 AC1 | Abrir `/reservas/<id>/pago` de una reserva pagada | Monto, fecha, reserva, estado y número de transacción | Pendiente. Se espera que falle el número (D1) |
| CP-312 | H06 AC2 | Reserva con un pago rechazado y otro aprobado, pulsar «Actualizar estado» | Se ve el aprobado | Pendiente |
| CP-313 | H06 AC3 | Reserva sin pagos | «Aún no hay un pago registrado para esta reserva» | Pendiente |
| CP-314 | H06 AC4 | Abrir la reserva de otro arrendatario | «Reserva no disponible», sin datos | Pendiente |
| CP-315 | H06 negativo | Reserva con pago rechazado | Estado RECHAZADO con el motivo | Pendiente |
| CP-321 | H17 AC1 | Reserva COMPLETADA sin calificar: «Calificar», dos escalas y comentario | Se guarda y la sección pasa a «Ya calificaste» | Pendiente |
| CP-322 | H17 AC2 | Abrir el detalle del bien calificado | Promedios «N.N de 5» y total de calificaciones | Pendiente |
| CP-323 | H17 AC3 | Reserva que no está COMPLETADA | No se ofrece calificar | Pendiente |
| CP-324 | H17 AC4 | Calificar una reserva ya calificada | No se ofrece calificar de nuevo | Pendiente |
| CP-325 | H17 AC5 | Abrir la reserva de otro arrendatario | «Reserva no disponible» | Pendiente |
| CP-326 | H17 AC6 | Enviar sin puntajes y con comentario de más de 500 | Avisos de validación; nada se guarda | Pendiente |
| CP-327 | H17 negativo | Doble clic en «Enviar calificación» | Una sola calificación | Pendiente |

Las reservas del ambiente solo se abren por id o desde las notificaciones, y
la sesión expira a los pocos minutos, por eso la mayoría sigue pendiente.

## 3. Casos de aceptación (los ejecuta Ricardo)

Un caso por criterio, con las mismas cuentas del seed. Cada uno se marca como
Pasa o Falla con su captura.

| Id | Criterio | Qué debe comprobar quien acepta |
|---|---|---|
| CA-301 | H03 AC1 | Que pedir fechas libres deja la solicitud PENDIENTE y sin apartar las fechas |
| CA-302 | H03 AC2 | Que el detalle muestra estado, fechas, costo del alquiler y depósito |
| CA-303 | H03 AC3 | Que no se puede pedir un fin anterior al inicio |
| CA-304 | H03 AC4 | Que no se puede pedir un día que ya pasó |
| CA-305 | H03 AC5 | Que no se puede pedir un periodo ocupado |
| CA-306 | H03 AC6 | Que sin verificación el sistema lo avisa y ofrece verificar |
| CA-307 | H03 AC7 | Que el arrendador recibe el aviso de la nueva solicitud |
| CA-311 | H06 AC1 | Que el estado del pago muestra monto, fecha, reserva, estado y recibo |
| CA-312 | H06 AC2 | Que tras un reintento se ve el pago más reciente |
| CA-313 | H06 AC3 | Que sin pagos aparece el aviso de que aún no hay pago |
| CA-314 | H06 AC4 | Que una reserva ajena no muestra ningún pago |
| CA-321 | H17 AC1 | Que se puede calificar el bien y al arrendador con comentario |
| CA-322 | H17 AC2 | Que el promedio del bien y del arrendador se ve con un decimal |
| CA-323 | H17 AC3 | Que una reserva no completada no se puede calificar |
| CA-324 | H17 AC4 | Que no se puede calificar dos veces la misma reserva |
| CA-325 | H17 AC5 | Que una reserva ajena no se puede calificar |
| CA-326 | H17 AC6 | Que los puntajes fuera de rango y los comentarios largos se rechazan |

## 4. Defectos y observaciones

**D1 (H06 AC1).** El criterio pide el número de transacción (recibo). El
backend lo devuelve como `pagoId`, pero la pantalla de estado del pago no lo
muestra. Pasos: abrir una reserva con un pago aprobado. Esperado: se ve el
número de transacción. Obtenido: solo estado, reserva, importe y fecha. El caso
queda como `it.fails` en `components/pagos/__tests__/h06-plan-pruebas.test.tsx`.

Diferencias de texto con los criterios (las pruebas validan el comportamiento
real; falta decidir si se ajusta el código o el criterio):
- H03 AC5: el backend responde «no está disponible».
- H17 AC4: responde «Ya calificaste esta reserva.» y el criterio dice «ya fue calificada».
- H06 AC4: el backend dice «La reserva no existe.» y el frontend «Reserva no disponible»; el criterio dice «Reserva no encontrada».

**Ambiente.** Varias publicaciones muestran la imagen rota porque el redeploy
borró las fotos de Render. No afecta a estas historias.
