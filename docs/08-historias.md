# Historias por módulo

Las 22 historias (H01 a H22) y el Módulo 0, con su responsable, su card de Jira y los PRs que las cerraron. Estado tomado de los PRs fusionados en `main` de los dos repositorios (backend `be_boilerplate_is_2026` y frontend `fe_boilerplate_is_2026`). "Terminada" quiere decir que todas sus tasks (DB, BE, FE y QA) tienen el PR fusionado y que forma parte de la versión 1.0.0. Las limitaciones conocidas están en [09-problemas-conocidos.md](09-problemas-conocidos.md).

La card es la historia en Jira (proyecto MP4); sus tasks cuelgan de ella. Un PR del backend se enlaza como `BE #n` y uno del frontend como `FE #n`.

## Módulo 0: Base común (cuentas por rol, perfil, despliegue y documentación)

Trabajo que no estaba en las historias, pero que las demás necesitan: cuentas por rol, perfil de usuario, rutas protegidas, seed, decisión de estado del frontend, README y despliegue.

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H00 | Registrarse con un rol y acceder solo a lo que me corresponde (rol, perfil, guard de roles, pantallas de registro, seed con una cuenta por rol y pruebas) | Lee Fuentes | [MP4-124](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-124) | [BE #4](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/4), [BE #5](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/5), [BE #10](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/10), [FE #1](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/1), [BE #17](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/17), [BE #80](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/80) | Terminada |
| — | Decidir y documentar el manejo de estado en el frontend | Lee Fuentes | [MP4-129](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-129) | [FE #17](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/17) | Terminada |
| — | README y /docs: integrantes, roles, diagramas y decisiones | Lee Fuentes | [MP4-130](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-130) | [BE #58](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/58), [FE #18](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/18) | Terminada |
| — | Configurar y desplegar la demo (backend, frontend y base de datos) | Lee Fuentes | [MP4-131](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-131) | [BE #59](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/59), [FE #19](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/19), [BE #83](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/83) | Terminada |

## Módulo 1: Catálogo de propiedades/equipo

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H01 | Publicar un equipo o espacio | Lee Fuentes | [MP4-10](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-10) | [BE #2](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/2), [BE #3](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/3), [BE #13](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/13), [FE #2](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/2), [BE #16](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/16) | Terminada |
| H12 | Ver el detalle completo de una publicación | Elias Milian | [MP4-11](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-11) | [BE #75](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/75), [BE #76](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/76), [FE #26](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/26), [BE #77](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/77) | Terminada |

## Módulo 2: Búsqueda y filtros

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H02 | Buscar equipos y espacios por palabra clave | Elias Milian | [MP4-12](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-12) | [BE #60](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/60), [BE #61](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/61), [FE #20](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/20), [BE #64](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/64) | Terminada |
| H11 | Filtrar resultados de búsqueda | Elias Milian | [MP4-13](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-13) | [BE #62](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/62), [BE #63](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/63), [FE #21](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/21), [BE #66](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/66) | Terminada |

## Módulo 3: Reservas y calendario de disponibilidad

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H03 | Solicitar una reserva | Mario Molina | [MP4-14](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-14) | [BE #15](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/15), [BE #67](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/67), [FE #23](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/23), [BE #73](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/73) | Terminada |
| H04 | Aprobar o rechazar una reserva | Henry Flores | [MP4-15](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-15) | [BE #31](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/31), [BE #40](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/40), [FE #10](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/10), [FE #16](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/16), [BE #51](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/51) | Terminada |
| H13 | Ver la disponibilidad real de un bien | Henry Flores | [MP4-16](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-16) | [BE #33](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/33), [BE #35](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/35), [FE #13](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/13), [BE #53](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/53) | Terminada |
| H14 | Bloquear fechas de un bien | Henry Flores | [MP4-17](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-17) | [BE #32](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/32), [BE #43](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/43), [FE #12](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/12), [BE #52](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/52) | Terminada |

## Módulo 4: Pagos y depósitos de garantía

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H05 | Realizar un pago simulado | Miguel Escobar | [MP4-18](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-18) | [BE #18](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/18), [BE #37](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/37), [FE #8](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/8), [BE #47](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/47) | Terminada |
| H06 | Consultar el estado de un pago | Mario Molina | [MP4-19](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-19) | [BE #68](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/68), [BE #69](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/69), [FE #24](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/24), [BE #70](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/70) | Terminada |
| H08 | Registrar la entrega de un equipo o espacio | Ricardo Pineda | [MP4-20](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-20) | [BE #25](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/25), [BE #26](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/26), [FE #6](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/6), [BE #27](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/27) | Terminada |
| H09 | Registrar la devolución y resolver la garantía | Elias Milian | [MP4-21](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-21) | [BE #55](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/55), [BE #56](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/56), [BE #57](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/57), [FE #22](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/22), [BE #65](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/65) | Terminada |

## Módulo 5: Mensajería entre arrendador y arrendatario

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H15 | Preguntar al arrendador antes de reservar | Lee Fuentes | [MP4-22](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-22) | [BE #9](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/9), [BE #14](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/14), [FE #15](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/15), [BE #49](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/49) | Terminada |
| H16 | Coordinar la entrega con el arrendatario | Lee Fuentes | [MP4-23](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-23) | [BE #41](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/41), [BE #45](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/45), [BE #48](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/48), [FE #14](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/14), [BE #50](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/50) | Terminada |

## Módulo 6: Reseñas y calificaciones

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H17 | Calificar el bien y al arrendador | Mario Molina | [MP4-24](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-24) | [BE #42](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/42), [BE #71](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/71), [FE #25](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/25), [BE #72](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/72) | Terminada |
| H18 | Calificar al arrendatario | Henry Flores | [MP4-25](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-25) | [BE #34](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/34), [BE #44](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/44), [FE #11](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/11), [BE #54](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/54) | Terminada |

## Módulo 7: Verificación de identidad/documentos

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H07 | Solicitar verificación de identidad | Ricardo Pineda | [MP4-26](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-26) | [BE #19](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/19), [BE #20](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/20), [BE #23](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/23), [FE #4](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/4), [BE #24](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/24) | Terminada |
| H19 | Exigir verificación para rentar | Ricardo Pineda | [MP4-27](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-27) | [BE #21](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/21), [BE #22](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/22), [FE #5](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/5), [FE #27](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/27), [BE #82](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/82) | Terminada |

## Módulo 8: Notificaciones

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H10 | Consultar notificaciones de mi alquiler | Miguel Escobar | [MP4-28](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-28) | [BE #1](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/1), [BE #11](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/11), [BE #78](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/78), [FE #3](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/3), [BE #79](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/79) | Terminada |
| H20 | Servicio de avisos | Miguel Escobar | [MP4-29](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-29) | [BE #7](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/7), [BE #8](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/8), [BE #12](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/12), [BE #36](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/36) | Terminada |

## Módulo 9: Panel de reportes para el arrendador

| ID | Historia | Responsable | Card | PR | Estado |
|---|---|---|---|---|---|
| H21 | Ver los ingresos del arrendador | Miguel Escobar | [MP4-30](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-30) | [BE #38](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/38), [BE #39](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/39), [FE #9](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/9), [BE #46](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/46) | Terminada |
| H22 | Ver la tasa de ocupación de cada bien | Ricardo Pineda | [MP4-31](https://mmitas-puebla-proyecto4.atlassian.net/browse/MP4-31) | [BE #28](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/28), [BE #29](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/29), [FE #7](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/pull/7), [BE #30](https://github.com/MiguelEscobar10/be_boilerplate_is_2026/pull/30) | Terminada |

## Resumen

- Historias: 22 de 22 terminadas (H01 a H22), con sus 91 tasks fusionadas.
- Módulo 0: cuentas por rol, seed, decisión de estado, README y despliegue fusionados.
- Historias pendientes: ninguna.
