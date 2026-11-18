# Módulo de reportes

Reportes para el arrendador (H22). Esta página tiene, por ahora, la consulta de
días ocupados y bloqueados (DB-22.1). El endpoint del reporte de tasa de
ocupación (BE-22.1) se documenta aquí cuando esté listo.

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

  `EN_CURSO` cuenta porque la tabla de estados del documento dice que esa
  reserva "ocupa las fechas del período", igual que `CONFIRMADA`, y porque
  H03, H04 y H11 revisan conflictos contra `CONFIRMADA` **o** `EN_CURSO`. Es
  la misma reserva antes y después de la entrega (H08): si no contara, un bien
  en uso aparecería libre justo mientras se está usando. Los criterios de H22
  nombran solo `CONFIRMADA` y `COMPLETADA` porque `EN_CURSO` aparece recién
  con H08; está conversado con el equipo en el PR #28.
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
