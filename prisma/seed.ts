import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { UserRole } from '../src/generated/prisma/enums.js';

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

async function crearCuenta(cuenta: CuentaSemilla) {
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

  for (const cuenta of CUENTAS) {
    await crearCuenta(cuenta);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
