# Reporte de ingresos del arrendador

Historia H21. El arrendador consulta cuánto le generó cada uno de sus bienes
en un período. Se apoya en la función SQL `listing_income` de
[DB-21.1](pagos.md#db-211-consulta-de-ingresos-por-bien-mp4-115).

Código en [`src/income/`](../../src/income) (`IncomeModule`, alias
`@Income`). Va aparte de `src/reports/`, que usa el reporte de ocupación
(BE-22.1).

## BE-21.1. Reporte de ingresos (MP4-116)

### Endpoint

`GET /api/v1/reportes/ingresos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`

Solo rol `ARRENDADOR`, sin body.

| Parámetro | Obligatorio | Significado |
|---|---|---|
| `desde` | no | Primer día del período (inclusive), en hora de El Salvador. Por defecto, el primer día del mes en curso. |
| `hasta` | no | Último día del período (inclusive), en hora de El Salvador. Por defecto, el último día del mes en curso. |

No hay parámetro de arrendador: se usa el id del token. Cualquier otro
parámetro (por ejemplo `arrendadorId`) da 400 por el `forbidNonWhitelisted`
del `ValidationPipe` global.

**Respuesta 200**

```json
{
  "desde": "2026-11-01",
  "hasta": "2026-11-30",
  "moneda": "USD",
  "total": "92.50",
  "porBien": [
    { "publicacionId": "3f6c1e2a-8b4d-4c1f-9a7e-2d5b6c7a8e90", "nombre": "A Taladro", "ingreso": "75.50" },
    { "publicacionId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "nombre": "B Carpa", "ingreso": "0.00" },
    { "publicacionId": "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f", "nombre": "C Bordes", "ingreso": "5.00" },
    { "publicacionId": "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918", "nombre": "D Antigua", "ingreso": "12.00" }
  ]
}
```

`porBien` va ordenado por nombre y luego por id, igual que la función.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | Fecha que no tiene el formato `AAAA-MM-DD` o que no existe (`2026-02-30`); `desde` posterior a `hasta`; rango de más de 366 días; parámetro no admitido. |
| 401 | Sin sesión. |
| 403 | La cuenta no es `ARRENDADOR` (por ejemplo, `ARRENDATARIO`). |

La ruta, sus parámetros y los cuatro códigos están documentados en Swagger
(`/api/docs`, etiqueta `reportes`).

### Reglas

- **Ingreso de un bien:** suma de `simulated_payments.rental_cost` de los
  pagos `APROBADO` de las reservas del bien cuya fecha (`created_at`) cae en
  el período. La suma la hace `listing_income`; el backend no la reescribe.
  `PENDIENTE` y `RECHAZADO` no cuentan, y el depósito (ni el retenido) tampoco.
- **Total:** suma de los `ingreso` de `porBien`, calculada con
  `Prisma.Decimal`.
- **Período:** `desde` y `hasta` son días inclusivos en America/El_Salvador
  (UTC−6 fijo, sin horario de verano). A la función se le pasa
  `[desde 00:00 SV, (hasta + 1 día) 00:00 SV)` convertido a UTC. Por ejemplo,
  del 1 al 30 de noviembre: `[2026-11-01T06:00Z, 2026-12-01T06:00Z)`. Un pago
  a las 23:59:59 SV del 30 cuenta; uno a las 00:00 SV del 1 de diciembre, no.
- **Fechas que faltan:** las dos son opcionales y cada una se completa por su
  lado. Sin `desde`, se usa el primer día del mes en curso; sin `hasta`, el
  último. El "mes en curso" se calcula con la hora de El Salvador: el 1 de
  diciembre a las 05:59Z todavía es noviembre. Un solo parámetro no da 400 por
  sí solo, pero las validaciones se aplican después de completar. Por eso
  `?desde=2026-12-05` en noviembre da 400 (desde posterior a hasta).
- **Máximo 366 días**, contando los dos extremos: del 2026-01-01 al
  2027-01-01 se acepta; un día más, 400.
- **Solo bienes del arrendador autenticado.**

### Decisiones

- **Una sola fecha:** se completa con el mes en curso, igual que el reporte
  de ocupación (BE-22.1). Así los dos reportes del arrendador se comportan
  igual.
- **Importes como texto con 2 decimales** (`"75.50"`), igual que BE-05.1 y
  que el catálogo. En JSON un `number` puede perder precisión, y el texto
  llega exacto desde `Decimal`. La ficha de Jira los muestra como número; el
  front puede convertirlos con `Number()` para mostrarlos.
- **`publicacionId` es UUID**, no un número como en el ejemplo de la ficha
  (igual que en BE-10.1).
- **Bienes desactivados:** `listing_income` devuelve todos los bienes con
  `is_active`. Los activos se muestran siempre (con `0.00` si no tuvieron
  ingresos). Los desactivados solo se muestran si su ingreso en el período es
  mayor que 0. Así el total siempre es la suma de la lista y coincide con los
  pagos, y no se listan bienes retirados que no aportan nada.
- **Reloj inyectable:** el servicio pide la hora a `Clock` (clase abstracta
  usada como token). La app usa `SystemClock`; las pruebas unitarias le pasan
  un reloj falso y la e2e lo reemplaza con
  `overrideProvider(Clock).useValue(...)`.
- **Fecha del ingreso:** es `simulated_payments.created_at`, como fija
  DB-21.1 (ver allí la salvedad de los ~2 s entre que se crea el intento y se
  aprueba).

### Pruebas

- **Unitarias**,
  [`src/income/services/income.service.spec.ts`](../../src/income/services/income.service.spec.ts):
  conversión del rango a UTC (también en el cambio de año), mes por defecto
  con reloj falso (incluidos el 1 de diciembre a las 05:59:59.999Z y a las
  06:00Z, y febrero bisiesto), completar solo `desde` o solo `hasta`, los 400
  (fecha inexistente, mes 13, desde > hasta, 367 días, y una sola fecha que
  queda posterior o anterior al mes en curso), 366 días aceptados, suma con
  `Decimal` (`0.10 + 0.20 = "0.30"`), filtro de desactivados y arrendador sin
  bienes.
- **e2e**, [`test/income.e2e-spec.ts`](../../test/income.e2e-spec.ts),
  contra la base `_test` con el reloj fijado. Crea dos arrendadores, un
  arrendatario y seis publicaciones (dos desactivadas, una del otro
  arrendador). Las reservas y los pagos se crean directo en la base.
  Comprueba:
  - Total y por bien, y que el total coincide con un `aggregate` de los pagos
    `APROBADO` del rango en la base.
  - Que `PENDIENTE` y `RECHAZADO` no cuentan (también dos rechazos antes del
    aprobado final) y que el depósito no se suma aunque sea mayor que el
    alquiler.
  - Bien sin ingresos con `0.00`; desactivado con ingresos visible y sin
    ingresos oculto.
  - Que cada arrendador ve solo sus bienes.
  - Bordes: 00:00:00 SV de `desde` cuenta y 1 ms antes no; 23:59:59 SV de
    `hasta` cuenta y 00:00 SV del día siguiente no.
  - Mes por defecto (16 de noviembre; 1 de diciembre a las 05:59:59Z →
    noviembre; a las 06:00Z → diciembre); solo `desde`; solo `hasta`.
  - Los 400 (fecha inexistente, dos formatos inválidos, desde > hasta, más de
    366 días, solo `desde` posterior al fin del mes, `arrendadorId`), 366 días
    aceptados, 401 sin token y 403 para un arrendatario.

  Al terminar borra los pagos, reservas, publicaciones y usuarios que creó.

Para repetirlas:

```bash
# Unitarias
npx vitest run src/income

# 1. Migraciones en la base de pruebas (la URL _test solo en este comando)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/si_be_boilerplate_test?schema=public" npx prisma migrate deploy

# 2. La e2e, con la DATABASE_URL normal del .env (el helper le agrega _test)
npx vitest run --config ./vitest.config.e2e.ts test/income.e2e-spec.ts --reporter=verbose
```

En el paso 2 no dejes `DATABASE_URL` apuntando a la base `_test`: el helper
le agregaría otro `_test`.
