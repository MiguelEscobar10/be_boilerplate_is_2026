# Módulo de reportes

Reportes para el arrendador (H22). Esta página documenta dos partes:
- la consulta de días ocupados y bloqueados (DB-22.1);
- el endpoint del reporte de tasa de ocupación (BE-22.1).

## Consulta de días ocupados y bloqueados (DB-22.1)

Migración: `prisma/migrations/20261116095509_create_occupancy_queries`.

No crea tablas. Son dos funciones SQL de solo lectura (`STABLE`) sobre
`reservations` y `availability_blocks` (DB-03.1). Prisma no modela funciones, así que
el backend las llama con `$queryRaw`.

### Reglas

- **Días en America/El_Salvador.** El período va por fechas inclusivas
  (`desde`–`hasta`). Cada día va de las 00:00 a las 24:00 hora local. Como las
  columnas guardan UTC sin zona, los límites del día se pasan a UTC antes de
  comparar (El Salvador es UTC-6 todo el año).
- **Ocupado.** Un día está ocupado si se cruza con alguna reserva `CONFIRMADA`,
  `EN_CURSO` o `COMPLETADA`. No cuentan `PENDIENTE`, `RECHAZADA` ni `CANCELADA`.
  Aunque varias reservas cubran el mismo día, se cuenta una sola vez.
- **Bloqueado.** Un día está bloqueado si se cruza con algún bloqueo. Un día
  bloqueado no cuenta como ocupado ni como disponible.
- **Períodos semiabiertos** `[start_at, end_at)`: una reserva que termina justo
  a la medianoche no ocupa el día siguiente.
- Basta con que una reserva o un bloqueo toque parte del día para que el día
  cuente.

### `listing_day_occupancy(p_listing_ids uuid[], p_from date, p_to date)`

Devuelve una fila por publicación y por día del período, con estas columnas:

| Columna | Tipo | Descripción |
|---|---|---|
| `listing_id` | `UUID` | Publicación. |
| `day` | `DATE` | Día local. |
| `blocked` | `BOOLEAN` | Algún bloqueo cubre el día. |
| `occupied` | `BOOLEAN` | Alguna reserva que cuenta cubre el día, y el día no está bloqueado. |

Sirve para un calendario o para revisar el cálculo día por día.

### `landlord_occupancy(p_landlord_id uuid, p_from date, p_to date)`

Devuelve los totales por publicación del arrendador, ordenados por nombre:

| Columna | Tipo | Descripción |
|---|---|---|
| `listing_id` | `UUID` | Publicación. |
| `listing_name` | `VARCHAR` | Nombre de la publicación. |
| `period_days` | `INTEGER` | Días del período (0 si `p_from > p_to`). |
| `blocked_days` | `INTEGER` | Días bloqueados. |
| `occupied_days` | `INTEGER` | Días ocupados, sin contar los bloqueados. |

Con estos totales, BE-22.1 calcula:

```
diasDisponibles = period_days - blocked_days
tasaOcupacion   = occupied_days / diasDisponibles × 100   (0.0 si diasDisponibles = 0)
```

La función incluye todas las publicaciones del arrendador, también las inactivas,
porque tienen historia de reservas. Una publicación sin reservas devuelve
`occupied_days = 0`. El rango máximo (366 días) lo valida el backend.

Ejemplo:

```sql
SELECT * FROM landlord_occupancy('<uuid del arrendador>', '2026-11-01', '2026-11-30');
```

### Índices

- Reservas: usa `reservations_listing_id_status_start_at_end_at_idx`
  (DB-03.1).
- Bloqueos: el índice `(listing_id, start_at, end_at)` lo agrega **DB-14.1**
  (Henry). Esta migración no lo duplica. Mientras no exista, la consulta de
  bloqueos recorre los bloqueos de la publicación, que en la práctica son pocos.

### Prueba

`test/reports.occupancy.e2e-spec.ts` corre contra la base local `_test` y cubre estos casos:
- traslapes contados una vez;
- los seis estados de reserva;
- bloqueos;
- la zona horaria;
- el fin de una reserva a la medianoche;
- los bordes del período;
- una publicación sin reservas;
- un arrendador ajeno;
- un período invertido.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" npx prisma migrate deploy
npx vitest run --config ./vitest.config.e2e.ts test/reports.occupancy.e2e-spec.ts
```

## API: reporte de tasa de ocupación (BE-22.1)

Código en `src/reports` (alias `@Reports`). El endpoint llama a
`landlord_occupancy` y aplica la fórmula.

### `GET /api/v1/reportes/ocupacion?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`

Solo **ARRENDADOR**, y la respuesta trae solo los bienes de quien inició sesión.

Parámetros:
- `desde` y `hasta` son fechas inclusivas en hora de El Salvador.
- Si faltan las dos, el período es el **mes calendario en curso**. Si falta solo una, se toma el límite correspondiente del mes en curso.
- El rango máximo es de 366 días.

```json
{
  "desde": "2026-11-01",
  "hasta": "2026-11-30",
  "items": [
    {
      "publicacionId": "5f0c…",
      "nombre": "Taladro",
      "diasOcupados": 6,
      "diasDisponibles": 28,
      "tasaOcupacion": 21.4
    }
  ]
}
```

Cómo se calcula cada campo:
- `diasDisponibles = días del período − días bloqueados`.
- `diasOcupados` son los días distintos cubiertos por reservas `CONFIRMADA`, `EN_CURSO` o `COMPLETADA`, sin contar los bloqueados.
- `tasaOcupacion = diasOcupados / diasDisponibles × 100`, con un decimal (redondeo a la mitad hacia arriba). Si `diasDisponibles` es 0, la tasa es 0.
- Un bien sin reservas aparece con `diasOcupados: 0` y `tasaOcupacion: 0`.
- `publicacionId` es el UUID de la publicación. En el ejemplo del documento aparece un número, pero en la base es UUID.

| Código | Cuándo |
|---|---|
| 400 | Formato distinto de `AAAA-MM-DD`, fecha inexistente (`2026-02-30`), `desde` posterior a `hasta`, rango de más de 366 días o un parámetro desconocido. |
| 401 | Sin sesión. |
| 403 | La cuenta no es de arrendador (ARRENDATARIO o REVISOR). |

Errores con el formato por defecto de Nest (`statusCode`, `message`, `error`),
como el resto de la API.

### Pruebas

Unitarias (`src/reports/services/reports.service.spec.ts`), que cubren:
- la fórmula y el redondeo;
- el mes en curso en la hora local, incluido un año bisiesto;
- las validaciones, que no llegan a consultar la base.

E2e (`test/reports.e2e-spec.ts`), que cubren:
- traslapes y bloqueos;
- un bien sin reservas y uno sin días disponibles;
- que cada arrendador recibe solo sus bienes;
- el mes por defecto;
- los 400, el rango de 366 días exactos, y los 403 y 401.
