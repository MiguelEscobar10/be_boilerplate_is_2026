# Documentación

## Entrega final (plantillas de la cátedra)

| Documento | Qué tiene |
|---|---|
| [01-guia-de-uso.md](01-guia-de-uso.md) | Roles, tabla de permisos y los flujos principales de cada módulo, paso a paso |
| [02-arquitectura.md](02-arquitectura.md) | Diagrama general, stack con versiones, estructura de los dos repositorios y decisiones técnicas |
| [03-modelo-de-datos.md](03-modelo-de-datos.md) | Diagrama entidad-relación y descripción de las 18 tablas |
| [04-api.md](04-api.md) | Autenticación y los 44 endpoints por módulo, con sus roles |
| [05-instalacion-local.md](05-instalacion-local.md) | Requisitos, pasos, variables de entorno y pruebas (bases `_test`) |
| [06-despliegue.md](06-despliegue.md) | Dónde está desplegado, cómo se publica una versión y variables de producción |
| [07-forma-de-trabajo.md](07-forma-de-trabajo.md) | Tablero de Jira, ramas, commits y pull requests |
| [08-historias.md](08-historias.md) | Las 22 historias y el Módulo 0, con responsable, tarjetas de Jira, PRs y estado |
| [09-problemas-conocidos.md](09-problemas-conocidos.md) | Problemas verificados, cómo se reproducen y su impacto |

## Documentación técnica

| Documento | Qué tiene |
|---|---|
| [arquitectura.md](arquitectura.md) | Vista general, módulos, capas del backend, flujo del alquiler, estados de la reserva y decisiones con su justificación |
| [modelo-de-datos.md](modelo-de-datos.md) | Diagrama entidad-relación de las 18 tablas y las reglas que viven en la base |
| [endpoints.md](endpoints.md) | Los 44 endpoints con su rol y para qué sirven, y las reglas comunes (autenticación, errores, 404 en recursos ajenos) |
| [modulos/](modulos/) | Un documento por módulo con sus tablas, endpoints, decisiones, cómo revertir sus migraciones y cómo probarlo |
| [despliegue.md](despliegue.md) | Cómo publicar la demo con Docker o en una plataforma administrada (MP4-131) |
| [qa/](qa/) | Evidencia de las pruebas de cada historia, con sus casos, capturas y revisión |
| [contratos/](contratos/) | Contratos acordados entre módulos |

En el repositorio del frontend:
[`docs/decisiones/manejo-de-estado.md`](https://github.com/MiguelEscobar10/fe_boilerplate_is_2026/blob/main/docs/decisiones/manejo-de-estado.md)
(sesión y estado) y un documento por pantalla en `docs/`.
