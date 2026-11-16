import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'Demo1234!';

// El rol REVISOR no se puede registrar por la API: solo existe si lo crea el
// seed (sección 2.1). En desarrollo hay un acceso por defecto; en un entorno
// desplegado (NODE_ENV=production) hay que definir las dos variables, para no
// dejar publicada una contraseña conocida.
const isProduction = process.env.NODE_ENV === 'production';
if (
  isProduction &&
  (!process.env.SEED_REVIEWER_EMAIL || !process.env.SEED_REVIEWER_PASSWORD)
) {
  throw new Error(
    'En producción definí SEED_REVIEWER_EMAIL y SEED_REVIEWER_PASSWORD antes de correr el seed.',
  );
}
const REVIEWER_EMAIL = process.env.SEED_REVIEWER_EMAIL ?? 'revisor@example.com';
const REVIEWER_PASSWORD = process.env.SEED_REVIEWER_PASSWORD ?? 'Revisor1234!';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // `upsert` hace el seed idempotente: se puede correr las veces que haga falta.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash },
  });

  console.log(`Usuario demo listo: ${user.email} / ${DEMO_PASSWORD}`);

  const reviewer = await prisma.user.upsert({
    where: { email: REVIEWER_EMAIL },
    update: { role: 'REVISOR' },
    create: {
      email: REVIEWER_EMAIL,
      passwordHash: await bcrypt.hash(REVIEWER_PASSWORD, 12),
      role: 'REVISOR',
      profile: { create: { name: 'Revisor de documentos', phone: '22223333' } },
    },
  });

  console.log(`Revisor listo: ${reviewer.email} / ${REVIEWER_PASSWORD}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
