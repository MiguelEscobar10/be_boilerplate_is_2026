# Forma de trabajo

**Tablero:** Jira, proyecto MP4 en
[mmitas-puebla-proyecto4.atlassian.net](https://mmitas-puebla-proyecto4.atlassian.net/jira/software/projects/MP4/boards/1)
(enlace tomado de [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

Cada historia (H00 a H22) tiene un dueño que hace sus cuatro tareas: base de
datos (DB), backend (BE), frontend (FE) y QA. Las columnas del tablero son
Tareas por hacer, En curso, En revisión, Control de calidad (solo para las
tareas QA) y Finalizada. Al abrir el PR la tarea pasa a En revisión, con el
enlace al PR en un comentario y las horas reales en *Log work*; al fusionarse,
a Finalizada. El detalle está en [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Ramas

No usamos Git Flow completo ni rama `develop`: todo se integra directo en
`main`.

- `main`: la única rama de integración. Cada PR se fusiona aquí.
- `feat/MP4-<n>-<ID>-<slug>`: una rama por tarea de Jira, ya creada desde la
  tarjeta. Por ejemplo `feat/MP4-108-BE-10.2-conectar-los-eventos-de-reservas-pagos`.
- `test/MP4-<n>-<ID>-<slug>`: las tareas de QA. Por ejemplo
  `test/MP4-110-QA-10.1-validar-avisos-lectura-y-privacidad`.
- `docs/...`: algunos cambios de documentación (por ejemplo
  `docs/MP4-130-readme-y-documentacion`).
- No hubo ramas `release/*` ni `hotfix/*`. La primera `release/1.0.0` está
  descrita como procedimiento en [despliegue](06-despliegue.md).

## Commits

Formato `MP4-<n> <ID>: Verbo en presente y qué hace`, por ejemplo
`MP4-106 DB-10.1: Crea la tabla notifications con su migracion`. Varios
commits chicos por tarea, uno por paso que se pueda explicar en una línea
(migración, prueba, documento, endpoint).

No usamos tipos (`feat`, `fix`...): el ID de la tarea ya dice de qué se trata
(DB, BE, FE, QA o DOC). En `main` del backend, 246 commits siguen este
formato; los anteriores son los del boilerplate de la cátedra.

## Pull requests

- **Título:** `MP4-<n> <ID>: <título de la tarea>`, por ejemplo
  `MP4-110 QA-10.1: Validar avisos, lectura y privacidad`.
- **Descripción:** qué incluye, cómo probarlo y qué queda pendiente.
- **Revisión obligatoria por otro integrante**, de preferencia alguien que
  dependa de la tarea. Quien revisa baja la rama y la prueba, no solo lee el
  diff.
- **PR apilados.** Si una tarea depende de otra que todavía no está en
  `main`, el PR se abre con base en la rama de la otra y se avisa en la
  descripción (por ejemplo, el PR #77 de QA-12.1 apunta a la rama de BE-12.1,
  #76). Se fusiona primero el PR base y se borra su rama, para que GitHub
  cambie la base del siguiente a `main`.
- Antes de abrir un PR se actualiza la rama con `main` para no chocar
  migraciones.
- **QA:** cada tarea QA deja su evidencia en [`qa/`](qa/) con sus casos,
  resultados, defectos y capturas. Los documentos de QA más recientes tienen
  una tabla «Revisión» (revisor, fecha y resultado) que llena quien revisa el
  PR; hoy la tienen 9 de los 21.
