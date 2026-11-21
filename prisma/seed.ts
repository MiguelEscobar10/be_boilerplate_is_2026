import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Prisma,
  PrismaClient,
  type User,
} from '../src/generated/prisma/client.js';
import type {
  ListingType,
  RateUnit,
  UserRole,
} from '../src/generated/prisma/enums.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'Demo1234!';

type CuentaSemilla = {
  rol: UserRole;
  /** Prefijo de las variables: SEED_<prefijo>_EMAIL y SEED_<prefijo>_PASSWORD. */
  variables: string;
  email: string;
  password: string;
  nombre: string;
  telefono: string;
};

// Una cuenta por rol, para poder entrar a la demo como cada uno (H00). El
// REVISOR además no se puede registrar por la API: solo existe si lo crea el
// seed (sección 2.1). En desarrollo hay accesos por defecto; en un entorno
// desplegado (NODE_ENV=production) hay que definir las variables de las tres
// cuentas, para no dejar publicada una contraseña conocida.
const CUENTAS: CuentaSemilla[] = [
  {
    rol: 'ARRENDADOR',
    variables: 'LANDLORD',
    email: 'arrendador@example.com',
    password: 'Arrendador1234!',
    nombre: 'Arrendador de prueba',
    telefono: '22221111',
  },
  {
    rol: 'ARRENDATARIO',
    variables: 'TENANT',
    email: 'arrendatario@example.com',
    password: 'Arrendatario1234!',
    nombre: 'Arrendatario de prueba',
    telefono: '22222222',
  },
  {
    rol: 'REVISOR',
    variables: 'REVIEWER',
    email: 'revisor@example.com',
    password: 'Revisor1234!',
    nombre: 'Revisor de documentos',
    telefono: '22223333',
  },
];

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  const faltantes = CUENTAS.flatMap(({ variables }) => [
    `SEED_${variables}_EMAIL`,
    `SEED_${variables}_PASSWORD`,
  ]).filter((nombre) => !process.env[nombre]);
  if (faltantes.length > 0) {
    throw new Error(
      `En producción definí ${faltantes.join(', ')} antes de correr el seed.`,
    );
  }
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function crearCuenta(cuenta: CuentaSemilla): Promise<User> {
  const email = process.env[`SEED_${cuenta.variables}_EMAIL`] ?? cuenta.email;
  const password =
    process.env[`SEED_${cuenta.variables}_PASSWORD`] ?? cuenta.password;

  // Si la cuenta ya existe se le asegura el rol, pero no se cambia su
  // contraseña: correr el seed otra vez no debe pisar una que se cambió a mano.
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: cuenta.rol },
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: cuenta.rol,
      profile: { create: { name: cuenta.nombre, phone: cuenta.telefono } },
    },
  });

  // En producción la contraseña viene de una variable: no se imprime.
  console.log(
    `${cuenta.rol} listo: ${user.email}${isProduction ? '' : ` / ${password}`}`,
  );
  return user;
}

// ---------------------------------------------------------------------------
// Datos de ejemplo (MP4-125)
//
// Publicaciones, un bloqueo y dos reservas para recorrer los flujos sin
// capturar nada a mano. Cada fila tiene un id fijo y se crea con
// `upsert(update: {})`: si ya existe no se toca, así que correr el seed otra
// vez no duplica nada ni deshace lo que se haya hecho en la demo (aprobar,
// pagar, entregar...). Las fechas se calculan la primera vez que se crea la
// fila y después quedan fijas.
//
// Las publicaciones no llevan fotos: las imágenes se guardan en disco
// (UPLOADS_DIR) y en Render el disco se pierde al reiniciar, así que una foto
// creada por el seed terminaría en 404. El frontend muestra "Sin fotografía"
// cuando una publicación no tiene imágenes.
// ---------------------------------------------------------------------------

type PublicacionEjemplo = {
  id: string;
  type: ListingType;
  name: string;
  description: string;
  location: string;
  rateAmount: string;
  rateUnit: RateUnit;
  depositAmount: string;
  conditions: string;
  requiresVerification?: boolean;
};

const PUBLICACIONES: PublicacionEjemplo[] = [
  {
    id: '5eed0001-0000-4000-8000-000000000001',
    type: 'EQUIPO',
    name: 'Taladro percutor 800 W',
    description:
      'Taladro percutor con maletín, juego de brocas para concreto y madera, y extensión de 10 m.',
    location: 'San Salvador, Colonia Escalón',
    rateAmount: '8.00',
    rateUnit: 'DIA',
    depositAmount: '20.00',
    conditions: 'Se entrega limpio y con las brocas completas.',
  },
  {
    id: '5eed0001-0000-4000-8000-000000000002',
    type: 'EQUIPO',
    name: 'Proyector multimedia 3500 lúmenes',
    description:
      'Proyector Full HD con cable HDMI, control remoto y pantalla portátil de 100 pulgadas.',
    location: 'Antiguo Cuscatlán, La Libertad',
    rateAmount: '15.00',
    rateUnit: 'DIA',
    depositAmount: '50.00',
    conditions:
      'Solo para arrendatarios con identidad verificada. No se presta para uso al aire libre con lluvia.',
    requiresVerification: true,
  },
  {
    id: '5eed0001-0000-4000-8000-000000000003',
    type: 'ESPACIO',
    name: 'Salón para eventos (80 personas)',
    description:
      'Salón climatizado con mesas, sillas, sonido básico y parqueo para 20 vehículos.',
    location: 'Santa Tecla, La Libertad',
    rateAmount: '25.00',
    rateUnit: 'HORA',
    depositAmount: '100.00',
    conditions: 'Se entrega barrido. Música hasta las 22:00.',
  },
  {
    id: '5eed0001-0000-4000-8000-000000000004',
    type: 'ESPACIO',
    name: 'Cabaña en la montaña',
    description:
      'Cabaña para 6 personas con cocina equipada, chimenea y vista al lago.',
    location: 'Apaneca, Ahuachapán',
    rateAmount: '45.00',
    rateUnit: 'NOCHE',
    depositAmount: '60.00',
    conditions:
      'Entrada a las 15:00 y salida a las 11:00. No se permiten mascotas.',
  },
  {
    id: '5eed0001-0000-4000-8000-000000000005',
    type: 'EQUIPO',
    name: 'Carpa plegable 3 x 3 m',
    description:
      'Carpa plegable con paredes laterales desmontables y bolsa de transporte.',
    location: 'San Miguel, San Miguel',
    rateAmount: '30.00',
    rateUnit: 'SEMANA',
    depositAmount: '25.00',
    conditions: 'Se devuelve seca y doblada en su bolsa.',
  },
];

const [TALADRO, , SALON, CABANA, CARPA] = PUBLICACIONES;

const ID_BLOQUEO = '5eed0002-0000-4000-8000-000000000001';
const ID_RESERVA_PENDIENTE = '5eed0003-0000-4000-8000-000000000001';
const ID_RESERVA_CONFIRMADA = '5eed0003-0000-4000-8000-000000000002';
const ID_RESERVA_COMPLETADA = '5eed0003-0000-4000-8000-000000000003';
const ID_PAGO_COMPLETADA = '5eed0004-0000-4000-8000-000000000001';
const ID_ENTREGA_COMPLETADA = '5eed0005-0000-4000-8000-000000000001';
const ID_DEVOLUCION_COMPLETADA = '5eed0006-0000-4000-8000-000000000001';
const ID_GARANTIA_COMPLETADA = '5eed0007-0000-4000-8000-000000000001';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** Hoy a la hora UTC indicada (15:00 UTC = 09:00 en El Salvador). */
function hoyALas(horaUtc: number): Date {
  const hoy = new Date();
  return new Date(
    Date.UTC(
      hoy.getUTCFullYear(),
      hoy.getUTCMonth(),
      hoy.getUTCDate(),
      horaUtc,
    ),
  );
}

/** Costo del alquiler como lo calcula H03: tarifa × unidades completas. */
function costo(
  publicacion: PublicacionEjemplo,
  unidades: number,
): Prisma.Decimal {
  return new Prisma.Decimal(publicacion.rateAmount).mul(unidades);
}

async function crearDatosDeEjemplo(arrendador: User, arrendatario: User) {
  for (const { id, ...datos } of PUBLICACIONES) {
    await prisma.listing.upsert({
      where: { id },
      update: {},
      create: { id, landlordId: arrendador.id, ...datos },
    });
  }

  // Bloqueo de la cabaña dentro de dos semanas (H14).
  const inicioBloqueo = new Date(hoyALas(15).getTime() + 14 * DIA_MS);
  await prisma.availabilityBlock.upsert({
    where: { id: ID_BLOQUEO },
    update: {},
    create: {
      id: ID_BLOQUEO,
      listingId: CABANA.id,
      startAt: inicioBloqueo,
      endAt: new Date(inicioBloqueo.getTime() + 3 * DIA_MS),
      reason: 'Mantenimiento de la cabaña',
      createdById: arrendador.id,
    },
  });

  // PENDIENTE: el salón por 4 horas dentro de una semana, para aprobarla o
  // rechazarla (H04) y después pagarla (H05).
  const inicioPendiente = new Date(hoyALas(20).getTime() + 7 * DIA_MS);
  await prisma.reservation.upsert({
    where: { id: ID_RESERVA_PENDIENTE },
    update: {},
    create: {
      id: ID_RESERVA_PENDIENTE,
      listingId: SALON.id,
      tenantId: arrendatario.id,
      startAt: inicioPendiente,
      endAt: new Date(inicioPendiente.getTime() + 4 * HORA_MS),
      status: 'PENDIENTE',
      rentalCost: costo(SALON, 4),
      depositAmount: SALON.depositAmount,
    },
  });

  // CONFIRMADA: el taladro por 3 días desde ayer. Ya empezó, así que se puede
  // pagar (H05), registrar la entrega (H08, exige que haya llegado el inicio)
  // y después la devolución (H09).
  const inicioConfirmada = new Date(hoyALas(15).getTime() - DIA_MS);
  await prisma.reservation.upsert({
    where: { id: ID_RESERVA_CONFIRMADA },
    update: {},
    create: {
      id: ID_RESERVA_CONFIRMADA,
      listingId: TALADRO.id,
      tenantId: arrendatario.id,
      startAt: inicioConfirmada,
      endAt: new Date(inicioConfirmada.getTime() + 3 * DIA_MS),
      status: 'CONFIRMADA',
      rentalCost: costo(TALADRO, 3),
      depositAmount: TALADRO.depositAmount,
      decidedAt: new Date(inicioConfirmada.getTime() - DIA_MS),
      decidedById: arrendador.id,
    },
  });

  await crearReservaCompletada(arrendador, arrendatario);

  console.log(
    `Datos de ejemplo listos: ${PUBLICACIONES.length} publicaciones, 1 bloqueo y 3 reservas.`,
  );
}

/**
 * COMPLETADA: la carpa hace 10 días, con todo lo que deja el flujo real y en
 * orden: solicitud → aprobación (H04) → pago APROBADO con la tarjeta de prueba
 * 4242 (H05) → entrega, que la pasa a EN_CURSO (H08) → devolución sin
 * observaciones (H09) → garantía liberada completa, que la cierra como
 * COMPLETADA (H09). Así el reporte de ingresos (cuenta el rental_cost del pago
 * APROBADO por su fecha) y el de ocupación (cuenta los días de reservas
 * COMPLETADA) tienen datos, y quedan pendientes las dos calificaciones (H17 y
 * H18) para probarlas.
 *
 * Es la carpa y no el proyector porque el proyector exige verificación de
 * identidad y el ARRENDATARIO del seed no está verificado.
 */
async function crearReservaCompletada(arrendador: User, arrendatario: User) {
  const inicio = new Date(hoyALas(15).getTime() - 10 * DIA_MS);
  const fin = new Date(inicio.getTime() + 3 * DIA_MS);
  // 3 días con tarifa SEMANA: se cobra 1 semana (la fracción redondea arriba).
  const costoAlquiler = costo(CARPA, 1);
  const deposito = new Prisma.Decimal(CARPA.depositAmount);

  await prisma.reservation.upsert({
    where: { id: ID_RESERVA_COMPLETADA },
    update: {},
    create: {
      id: ID_RESERVA_COMPLETADA,
      listingId: CARPA.id,
      tenantId: arrendatario.id,
      startAt: inicio,
      endAt: fin,
      status: 'COMPLETADA',
      rentalCost: costoAlquiler,
      depositAmount: deposito,
      createdAt: new Date(inicio.getTime() - 4 * DIA_MS),
      decidedAt: new Date(inicio.getTime() - 3 * DIA_MS),
      decidedById: arrendador.id,
    },
  });

  await prisma.simulatedPayment.upsert({
    where: { id: ID_PAGO_COMPLETADA },
    update: {},
    create: {
      id: ID_PAGO_COMPLETADA,
      reservationId: ID_RESERVA_COMPLETADA,
      totalAmount: costoAlquiler.plus(deposito),
      rentalCost: costoAlquiler,
      depositAmount: deposito,
      status: 'APROBADO',
      cardLast4: '4242',
      attemptNumber: 1,
      createdAt: new Date(inicio.getTime() - 2 * DIA_MS),
    },
  });

  await prisma.delivery.upsert({
    where: { id: ID_ENTREGA_COMPLETADA },
    update: {},
    create: {
      id: ID_ENTREGA_COMPLETADA,
      reservationId: ID_RESERVA_COMPLETADA,
      deliveredAt: inicio,
      initialConditionNote:
        'Carpa completa, sin roturas, con sus cuatro paredes y la bolsa.',
      registeredById: arrendador.id,
    },
  });

  await prisma.return.upsert({
    where: { id: ID_DEVOLUCION_COMPLETADA },
    update: {},
    create: {
      id: ID_DEVOLUCION_COMPLETADA,
      reservationId: ID_RESERVA_COMPLETADA,
      returnedAt: fin,
      finalState: 'SIN_OBSERVACIONES',
      observations: 'Se devolvió seca y doblada.',
      registeredById: arrendador.id,
      createdAt: fin,
    },
  });

  await prisma.depositResolution.upsert({
    where: { id: ID_GARANTIA_COMPLETADA },
    update: {},
    create: {
      id: ID_GARANTIA_COMPLETADA,
      reservationId: ID_RESERVA_COMPLETADA,
      originalDeposit: deposito,
      retainedAmount: 0,
      releasedAmount: deposito,
      status: 'LIBERADA',
      resolvedAt: new Date(fin.getTime() + HORA_MS),
    },
  });
}

async function main() {
  // `upsert` hace el seed idempotente: se puede correr las veces que haga falta.
  // El usuario demo del boilerplate tiene una contraseña conocida, así que
  // solo se crea en desarrollo.
  if (!isProduction) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const user = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: { email: DEMO_EMAIL, passwordHash },
    });
    console.log(`Usuario demo listo: ${user.email} / ${DEMO_PASSWORD}`);
  }

  const usuarios = new Map<UserRole, User>();
  for (const cuenta of CUENTAS) {
    usuarios.set(cuenta.rol, await crearCuenta(cuenta));
  }

  await crearDatosDeEjemplo(
    usuarios.get('ARRENDADOR')!,
    usuarios.get('ARRENDATARIO')!,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
