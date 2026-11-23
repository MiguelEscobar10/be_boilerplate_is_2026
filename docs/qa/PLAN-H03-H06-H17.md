# Plan de pruebas: H03, H06 y H17

Responsable: Mario Molina. Aceptación: Ricardo (pareja cruzada).
Historias: **H03. Solicitar una reserva**, **H06. Consultar el estado de un pago**
y **H17. Calificar el bien y al arrendador** (17 criterios en total).

Ambiente de las pruebas manuales: https://mp4-frontend.onrender.com, con el
arrendatario del seed. No se hizo redeploy ni merge a main.

## 1. Pruebas de componente (automatizadas)

La numeración de los criterios es la de la hoja Trazabilidad del Excel del plan.
En H03 difiere del documento de historias: allí AC4 es la fecha pasada, AC5 el
periodo ocupado, AC6 la verificación y AC7 el aviso.

Un `it('ACn: …')` por criterio. Backend: se renombraron los casos de las suites
QA que ya existían y se dejó el id original entre paréntesis. Frontend: un
archivo `hNN-plan-pruebas.test.tsx` por historia.

Backend, `npm run test:e2e -- qa-03.1 qa-06.1 qa-17.1`. Frontend, `npm test`.

| Criterio | Backend (archivo, caso) | Frontend | Resultado |
|---|---|---|---|
| H03 AC1 solicitud válida queda PENDIENTE | qa-03.1, S01 | h03, AC1 | Pasa |
| H03 AC2 el detalle trae estado, fechas, costo y depósito | qa-03.1, S17 | h03, AC2 | Pasa |
| H03 AC3 fin anterior o igual al inicio da 400 | qa-03.1, S10 | h03, AC3 | Pasa |
| H03 AC4 periodo ocupado da 409 | qa-03.1, S03 | h03, AC4 | Pasa |
| H03 AC5 inicio ya pasado da 400 FECHA_PASADA | qa-03.1, S08 | h03, AC5 | Pasa |
| H03 AC6 aviso «Nueva solicitud de reserva» | qa-03.1, S18 | no aplica (solo backend) | Pasa |
| H03 AC7 verificación requerida da 422 | qa-03.1, S20 | h03, AC7 | Pasa |
| H06 AC1 monto, fecha, número de reserva y estado del pago | qa-06.1, C01 | h06, AC1 | Pasa |
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

Resultado: backend 66/66 en las tres suites; frontend 593 pruebas pasan, ninguna falla.

## 2. Casos del plan (CP-301 a CP-334)

Los casos completos (precondiciones, datos, pasos, resultado esperado y real,
evidencia) están en la hoja Casos del Excel del plan. Aquí va el índice.
Las capturas están en `docs/qa/evidencias/plan-H03-H06-H17/`, con el id del caso
como nombre (CP-319a.png, CP-319b.png…).

| Id | Historia | Nivel | Tipo | Criterios | Caso | Estado |
|---|---|---|---|---|---|---|
| CP-301 | H03 | Componente | Mixto | H03-AC1, H03-AC2, H03-AC3, H03-AC4, H03-AC5, H03-AC6, H03-AC7 | Suite de componente H03 (backend y frontend) | Pasó |
| CP-302 | H06 | Componente | Mixto | H06-AC1, H06-AC2, H06-AC3, H06-AC4 | Suite de componente H06 (backend y frontend) | Pasó |
| CP-303 | H17 | Componente | Mixto | H17-AC1, H17-AC2, H17-AC3, H17-AC4, H17-AC5, H17-AC6 | Suite de componente H17 (backend y frontend) | Pasó |
| CP-304 | H03 | Integración | Positivo | H03-AC1, H03-AC2 | Solicitud válida queda PENDIENTE y el detalle trae período, costo y depósito | Pasó |
| CP-305 | H03 | Integración | Negativo | H03-AC3, H03-AC5 | Fechas inválidas: fin anterior o igual al inicio, e inicio en el pasado | Pasó |
| CP-306 | H03 | Integración | Negativo | H03-AC4 | Período que se cruza con una reserva CONFIRMADA da 409 | Pasó |
| CP-307 | H03 | Integración | Positivo | H03-AC6 | El arrendador recibe el aviso «Nueva solicitud de reserva» | Pasó |
| CP-308 | H03 | Integración | Negativo | H03-AC7 | Sin verificación, un bien que la exige rechaza la solicitud | Pasó |
| CP-309 | H06 | Integración | Positivo | H06-AC1 | Consultar el pago de una reserva propia | Pasó |
| CP-310 | H06 | Integración | Positivo | H06-AC2 | Tras un rechazo y un pago aprobado se devuelve el más reciente | Pasó |
| CP-311 | H06 | Integración | Negativo | H06-AC3 | Reserva sin pagos: aún no hay pago registrado | Pasó |
| CP-312 | H06 | Integración | Negativo | H06-AC4 | Reserva de otro arrendatario: no se puede ver su pago | Pasó |
| CP-313 | H17 | Integración | Positivo | H17-AC1 | Consultar la calificación guardada de una reserva COMPLETADA | Pasó |
| CP-314 | H17 | Integración | Positivo | H17-AC2 | El promedio del bien y del arrendador se ve en el detalle de la publicación | Pasó |
| CP-315 | H17 | Integración | Negativo | H17-AC3 | Reserva que no está COMPLETADA no se puede calificar | Pasó |
| CP-316 | H17 | Integración | Negativo | H17-AC4 | Calificar dos veces la misma reserva da 409 | Pasó |
| CP-317 | H17 | Integración | Negativo | H17-AC5 | Reserva de otro arrendatario: no se puede calificar | Pasó |
| CP-318 | H17 | Integración | Negativo | H17-AC6 | Puntajes fuera de rango o comentario de más de 500 caracteres | Pasó |
| CP-319 | H03 | Sistema | Positivo | H03-AC1, H03-AC2 | Solicitar una reserva desde el calendario y ver su resumen | Pasó |
| CP-320 | H03 | Sistema | Negativo | H03-AC4, H03-AC5 | El calendario no deja elegir días pasados ni ocupados | Pasó |
| CP-321 | H03 | Sistema | Negativo | H03-AC7 | Sin verificación, la solicitud no se envía y se explica el motivo | Pasó |
| CP-322 | H03 | Sistema | Positivo | H03-AC6 | El arrendador ve el aviso de la nueva solicitud en su bandeja | Pasó |
| CP-323 | H06 | Sistema | Positivo | H06-AC1 | Ver el estado del pago en el detalle de la reserva | Pasó |
| CP-324 | H06 | Sistema | Negativo | H06-AC3 | Reserva sin pagos muestra el aviso de que aún no hay pago | Pasó |
| CP-325 | H17 | Sistema | Positivo | H17-AC1 | Calificar el bien y al arrendador desde la reserva | Pasó |
| CP-326 | H17 | Sistema | Negativo | H17-AC6 | El formulario valida los puntajes y el comentario | Pasó |
| CP-327 | H17 | Sistema | Positivo | H17-AC2 | Los promedios aparecen en el detalle de la publicación | Pasó |
| CP-328 | H17 | Sistema | Negativo | H17-AC3 | Una reserva que no está COMPLETADA no ofrece calificar | Pasó |
| CP-329 | H03 | Aceptación | Positivo | H03-AC1, H03-AC2, H03-AC6 | Aceptación: pedir una reserva y que el arrendador se entere | No ejecutado |
| CP-330 | H03 | Aceptación | Negativo | H03-AC3, H03-AC4, H03-AC5, H03-AC7 | Aceptación: solicitudes que el sistema debe rechazar | No ejecutado |
| CP-331 | H06 | Aceptación | Positivo | H06-AC1, H06-AC2 | Aceptación: consultar el estado de mis pagos | No ejecutado |
| CP-332 | H06 | Aceptación | Negativo | H06-AC3, H06-AC4 | Aceptación: sin pagos y reserva ajena | No ejecutado |
| CP-333 | H17 | Aceptación | Positivo | H17-AC1, H17-AC2 | Aceptación: calificar una reserva completada | No ejecutado |
| CP-334 | H17 | Aceptación | Negativo | H17-AC3, H17-AC4, H17-AC5, H17-AC6 | Aceptación: calificaciones que el sistema debe rechazar | No ejecutado |

Los casos de Integración se ejecutan con Swagger en el ambiente desplegado, los
de Sistema desde el navegador y los de Aceptación los ejecuta Ricardo Pineda.
Los de Sistema y Aceptación usan las reservas del seed (pendiente, confirmada y
completada). Hasta ahora están ejecutados los tres de Componente, los diez de Sistema (CP-319 a CP-328)
y los quince de Integración (CP-304 a CP-318); los seis de Aceptación siguen como «No ejecutado».
CP-310 se hizo con la reserva faaf6270-5bdf-41e6-824f-9be22aca7f0a (CP-304, aprobada por el
arrendador): primero un pago rechazado con la tarjeta 0002 y luego uno aprobado con la 4242;
la consulta del último pago devuelve cada vez el más reciente.
CP-313 consulta la calificación ya guardada de la reserva del seed (la creó CP-325 desde la
pantalla); el POST se cubre en CP-325 y en el 409 de CP-316. La sesión del ambiente desplegado
expira a los 15 minutos, por eso la ejecución manual se hace por tandas.

## 3. Defectos y observaciones

No hay defectos abiertos en H03, H06 ni H17.

Diferencias de texto entre lo que responde el sistema y lo que dicen los
criterios (las pruebas validan el comportamiento real; falta decidir si se
ajusta el código o el criterio):
- H03 AC4: el backend responde «no está disponible».
- H17 AC4: responde «Ya calificaste esta reserva.» y el criterio dice «ya fue calificada».
- H06 AC4: el backend dice «La reserva no existe.» y el frontend «Reserva no disponible».

**Ambiente.** Varias publicaciones muestran la imagen rota porque el redeploy
borró las fotos de Render. No afecta a estas historias.
