# Cómo trabajamos (Jira + GitHub)

Guía corta para que el código y el tablero de Jira
([MP4](https://mmitas-puebla-proyecto4.atlassian.net/jira/software/projects/MP4/boards/1))
cuenten la misma historia. Los commits, los PR y los movimientos de Jira son
evidencia del trabajo: si algo se hace fuera de este flujo, no queda registrado.

## Antes de empezar

- Se trabaja **siempre en este fork** (`MiguelEscobar10/be_boilerplate_is_2026`),
  nunca en el repo original ni en copias personales.
- Cada task de Jira ya tiene su rama creada:
  `feat/MP4-<n>-<ID>-<titulo>` (QA usa `test/...`). Usá esa, no inventes otra.
- Node 24 (el mismo del Dockerfile) y el `.env` copiado de `.env.example`.

## El flujo de una task

Estados del tablero: **Tareas por hacer**, **En curso**, **En revisión**,
**Control de calidad** y **Finalizada**. Entre paréntesis va el nombre de la
columna, por si alguien tiene Jira en otro idioma.

| Paso | Jira | GitHub |
|---|---|---|
| 1. Arrancás | Mové la task a **En curso** (En Progreso) | `git fetch && git checkout <tu rama>` |
| 2. Trabajás | | Commits chicos, uno por paso lógico |
| 3. Terminás | Mové a **En revisión** (Code Review), comentá con el link del PR y registrá tus horas (*Log work*) | Abrí el PR con la clave en el título y asigná revisor |
| 4. Te aprueban y se hace el merge | Mové a **Finalizada** (Hecho) | Merge a `main` (respetando el orden si hay PR encadenados) |

**Control de calidad** (QA) es solo para las tasks de pruebas (QA-xx): la task
de pruebas pasa por ahí mientras se ejecutan los casos y queda en
**Finalizada** cuando pasan. Las tasks de desarrollo (DB, BE, FE) no pasan
por esa columna.

## Commits

- Formato: `MP4-<n> <ID>: Verbo en presente y qué hace`
  - `MP4-106 DB-10.1: Crea la tabla notifications con su migracion`
- Varios commits por task, no uno gigante al final. Un commit = un paso que
  se puede explicar en una línea (migración, prueba, doc, endpoint...).
- Cuando la integración GitHub for Jira esté activa, se puede registrar tiempo
  desde el commit: `MP4-81 DB-15.1: Crea las tablas de mensajes #time 2h`.

## Pull requests

- Título: `MP4-<n> <ID>: <título de la task>`.
- En la descripción: qué incluye, cómo probarlo y qué queda pendiente.
- Revisor: otra persona del equipo, de preferencia alguien que dependa de tu
  task. Quien revisa **baja la rama y la prueba**, no solo lee el diff.
- Si tu task depende de otra que todavía no está en `main`, abrí el PR con
  base en la rama de la otra task y avisalo en la descripción.

## Horas

- Registrá en cada task las horas **reales** que le dedicaste (*Log work*). La
  estimación original ya está cargada; Jira compara las dos.
- Si una task se va a pasar mucho de lo estimado, comentalo en el ticket.

## Base de datos

- Una migración por task de DB, creada con `npx prisma migrate dev --name ...`.
- Hacé `git fetch` y actualizá tu rama antes de abrir el PR para no chocar
  migraciones con otro. Al terminar una DB-xx.1, avisá al equipo.
- Las pruebas de base corren contra una base `_test` local, nunca la de
  desarrollo (ver `docs/modulos/notificaciones.md`).

## Documentación

Cada quien documenta su módulo en `docs/modulos/<modulo>.md` al cerrar su
historia: modelo de datos, endpoints, decisiones y su justificación.

## Sprints

| Sprint | Fechas | Meta |
|---|---|---|
| 1 | sáb 14 a lun 16 | Fundaciones: tablas, servicio de avisos, publicar, buscar y roles |
| 2 | mar 17 a mié 18 | Reservar, aprobar, pagar y conectar los frontends |
| 3 | jue 19 a vie 20 | Módulos restantes, documentación, despliegue y entrega del repo |
| 4 | sáb 21 a lun 23 | Plan de pruebas y QA pendiente |

Al cerrar un sprint, lo que no esté en **Finalizada** pasa al siguiente.
