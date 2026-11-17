import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { IdentityVerificationStatus, PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de `identity_verifications` (DB-07.1).
 *
 * Igual que las de reservas y pagos: corre solo contra una base local cuyo
 * nombre termina en `_test` (TEST_DATABASE_URL, o DATABASE_URL + `_test`).
 * Crea su propio arrendatario y revisor con un email único y al final borra
 * solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error('Definí TEST_DATABASE_URL o DATABASE_URL.');
  }

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;

  const dbName = url.pathname.slice(1);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `La base de pruebas debe ser local (host: ${url.hostname}).`,
    );
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (es ${dbName}).`,
    );
  }
  return url.toString();
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }),
});

describe('verificación de identidad: restricciones (DB-07.1)', () => {
  const email = `db-07.1-${randomUUID()}@test.local`;
  let reviewerId: string;

  // Cada prueba usa su propio arrendatario para no chocar con el índice único
  // de una sola solicitud PENDIENTE por usuario.
  const newTenant = () =>
    prisma.user.create({
      data: {
        email: `tenant-${randomUUID()}-${email}`,
        passwordHash: 'no-es-un-hash-real',
      },
    });

  const SUBMITTED = new Date('2026-12-01T09:00:00Z');
  const REVIEWED = new Date('2026-12-01T10:00:00Z');
  const pending = (userId: string) => ({
    userId,
    documentKey: `verificaciones/${userId}/${randomUUID()}.pdf`,
    submittedAt: SUBMITTED,
  });
  const decided = (
    userId: string,
    status: IdentityVerificationStatus = 'APROBADA',
  ) => ({
    ...pending(userId),
    status,
    reviewedById: reviewerId,
    reviewedAt: REVIEWED,
  });

  beforeAll(async () => {
    const reviewer = await prisma.user.create({
      data: {
        email: `reviewer-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'REVISOR',
      },
    });
    reviewerId = reviewer.id;
  });

  afterAll(async () => {
    // Las solicitudes van primero: la FK del revisor es RESTRICT. Las del
    // arrendatario se borrarían solas (CASCADE), pero las decididas no dejarían
    // borrar al revisor.
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  it('guarda la solicitud en PENDIENTE, sin decisión, y la relaciona con el usuario', async () => {
    const tenant = await newTenant();
    const verification = await prisma.identityVerification.create({
      data: { userId: tenant.id, documentKey: 'verificaciones/doc.pdf' },
      include: { user: true },
    });

    expect(verification.status).toBe('PENDIENTE');
    expect(verification.submittedAt).toBeInstanceOf(Date);
    expect(verification.rejectionReason).toBeNull();
    expect(verification.reviewedById).toBeNull();
    expect(verification.reviewedAt).toBeNull();
    expect(verification.user.id).toBe(tenant.id);
  });

  it('el enum IdentityVerificationStatus tiene los tres estados de la sección 2.3', async () => {
    const [row] = await prisma.$queryRaw<{ values: string[] }[]>`
      SELECT enum_range(NULL::"IdentityVerificationStatus")::text[] AS values`;

    const expected = ['PENDIENTE', 'APROBADA', 'RECHAZADA'];
    expect(row.values).toEqual(expected);
    expect(Object.values(IdentityVerificationStatus)).toEqual(expected);
  });

  it('rechaza un estado fuera del enum', async () => {
    // SQL crudo: el cliente de Prisma ya lo rechazaría antes de llegar a la base.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "identity_verifications" SET "status" = $1::"IdentityVerificationStatus" WHERE false`,
        'VENCIDA',
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it('guarda una decisión APROBADA con su revisor y su fecha', async () => {
    const tenant = await newTenant();
    const verification = await prisma.identityVerification.create({
      data: decided(tenant.id),
      include: { reviewedBy: true },
    });

    expect(verification.status).toBe('APROBADA');
    expect(verification.reviewedBy?.id).toBe(reviewerId);
    expect(verification.reviewedAt).toEqual(REVIEWED);
  });

  it('guarda una decisión RECHAZADA con motivo y otra sin motivo', async () => {
    const tenant = await newTenant();
    const withReason = await prisma.identityVerification.create({
      data: {
        ...decided(tenant.id, 'RECHAZADA'),
        rejectionReason: 'Documento ilegible',
      },
    });
    const withoutReason = await prisma.identityVerification.create({
      data: decided(tenant.id, 'RECHAZADA'),
    });

    expect(withReason.rejectionReason).toBe('Documento ilegible');
    expect(withoutReason.rejectionReason).toBeNull();
  });

  it('pasa de PENDIENTE a una decisión al actualizar la misma fila', async () => {
    const tenant = await newTenant();
    const { id } = await prisma.identityVerification.create({
      data: pending(tenant.id),
    });

    const updated = await prisma.identityVerification.update({
      where: { id },
      data: {
        status: 'APROBADA',
        reviewedById: reviewerId,
        reviewedAt: REVIEWED,
      },
    });
    expect(updated.status).toBe('APROBADA');
  });

  describe('una sola solicitud PENDIENTE por usuario', () => {
    it('rechaza una segunda PENDIENTE del mismo usuario', async () => {
      const tenant = await newTenant();
      await prisma.identityVerification.create({ data: pending(tenant.id) });

      await expect(
        prisma.identityVerification.create({ data: pending(tenant.id) }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('acepta una nueva PENDIENTE después de una RECHAZADA o APROBADA', async () => {
      const tenant = await newTenant();
      await prisma.identityVerification.create({
        data: decided(tenant.id, 'RECHAZADA'),
      });
      await prisma.identityVerification.create({ data: decided(tenant.id) });

      const again = await prisma.identityVerification.create({
        data: pending(tenant.id),
      });
      expect(again.status).toBe('PENDIENTE');
    });

    it('permite que dos usuarios distintos tengan una PENDIENTE cada uno', async () => {
      const [a, b] = await Promise.all([newTenant(), newTenant()]);
      await prisma.identityVerification.create({ data: pending(a.id) });

      await expect(
        prisma.identityVerification.create({ data: pending(b.id) }),
      ).resolves.toMatchObject({ status: 'PENDIENTE' });
    });
  });

  describe('coherencia de la decisión', () => {
    it.each([
      ['revisor', () => ({ reviewedById: reviewerId })],
      ['fecha de revisión', () => ({ reviewedAt: REVIEWED })],
    ])('rechaza una PENDIENTE con %s', async (_, extra) => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...pending(tenant.id), ...extra() },
        }),
      ).rejects.toThrow(/identity_verifications_review_check/);
    });

    it.each(['APROBADA', 'RECHAZADA'] as const)(
      'rechaza una %s sin revisor o sin fecha de revisión',
      async (status) => {
        const tenant = await newTenant();
        const base = decided(tenant.id, status);

        await expect(
          prisma.identityVerification.create({
            data: { ...base, reviewedById: null },
          }),
        ).rejects.toThrow(/identity_verifications_review_check/);
        await expect(
          prisma.identityVerification.create({
            data: { ...base, reviewedAt: null },
          }),
        ).rejects.toThrow(/identity_verifications_review_check/);
      },
    );

    it('rechaza que el usuario decida su propia solicitud', async () => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...decided(tenant.id), reviewedById: tenant.id },
        }),
      ).rejects.toThrow(/identity_verifications_reviewer_not_owner_check/);
    });

    it('rechaza una revisión anterior al envío', async () => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: {
            ...decided(tenant.id),
            reviewedAt: new Date(SUBMITTED.getTime() - 1000),
          },
        }),
      ).rejects.toThrow(/identity_verifications_reviewed_at_check/);
    });
  });

  describe('motivo de rechazo', () => {
    it.each([
      ['PENDIENTE', (userId: string) => pending(userId)],
      ['APROBADA', (userId: string) => decided(userId)],
    ])('rechaza un motivo en una solicitud %s', async (_, build) => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...build(tenant.id), rejectionReason: 'No aplica' },
        }),
      ).rejects.toThrow(/identity_verifications_rejection_reason_check/);
    });

    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['solo saltos de línea y tabs', '\n\t\n'],
    ])('rechaza un motivo %s', async (_, reason) => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...decided(tenant.id, 'RECHAZADA'), rejectionReason: reason },
        }),
      ).rejects.toThrow(/identity_verifications_rejection_reason_check/);
    });

    it('acepta un motivo de 500 caracteres y rechaza uno de 501', async () => {
      const tenant = await newTenant();
      const ok = await prisma.identityVerification.create({
        data: {
          ...decided(tenant.id, 'RECHAZADA'),
          rejectionReason: 'a'.repeat(500),
        },
      });
      expect(ok.rejectionReason).toHaveLength(500);

      await expect(
        prisma.identityVerification.create({
          data: {
            ...decided(tenant.id, 'RECHAZADA'),
            rejectionReason: 'a'.repeat(501),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2000' });
    });
  });

  describe('referencia al documento', () => {
    it.each([
      ['vacía', ''],
      ['solo espacios', '   '],
    ])('rechaza una referencia %s', async (_, documentKey) => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...pending(tenant.id), documentKey },
        }),
      ).rejects.toThrow(/identity_verifications_document_key_check/);
    });

    it('acepta una referencia de 255 caracteres y rechaza una de 256', async () => {
      const tenant = await newTenant();
      const ok = await prisma.identityVerification.create({
        data: { ...pending(tenant.id), documentKey: 'k'.repeat(255) },
      });
      expect(ok.documentKey).toHaveLength(255);

      await expect(
        prisma.identityVerification.create({
          data: { ...pending(tenant.id), documentKey: 'k'.repeat(256) },
        }),
      ).rejects.toMatchObject({ code: 'P2000' });
    });
  });

  describe('claves foráneas', () => {
    it('rechaza un usuario que no existe (FK)', async () => {
      await expect(
        prisma.identityVerification.create({ data: pending(randomUUID()) }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rechaza un revisor que no existe (FK)', async () => {
      const tenant = await newTenant();

      await expect(
        prisma.identityVerification.create({
          data: { ...decided(tenant.id), reviewedById: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('borra las solicitudes al borrar al usuario (ON DELETE CASCADE)', async () => {
      const tenant = await newTenant();
      await prisma.identityVerification.create({ data: pending(tenant.id) });

      await prisma.user.delete({ where: { id: tenant.id } });

      expect(
        await prisma.identityVerification.count({
          where: { userId: tenant.id },
        }),
      ).toBe(0);
    });

    it('no deja borrar a un revisor que decidió solicitudes (RESTRICT)', async () => {
      const reviewer = await prisma.user.create({
        data: {
          email: `restrict-${email}`,
          passwordHash: 'x',
          role: 'REVISOR',
        },
      });
      const tenant = await newTenant();
      await prisma.identityVerification.create({
        data: { ...decided(tenant.id), reviewedById: reviewer.id },
      });

      await expect(
        prisma.user.delete({ where: { id: reviewer.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('índices', () => {
    const indexDef = async (name: string) => {
      const [row] = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'identity_verifications' AND indexname = ${name}`;
      return row?.indexdef;
    };

    it('tiene el índice (user_id, submitted_at DESC) para la última solicitud del usuario', async () => {
      expect(
        await indexDef('identity_verifications_user_id_submitted_at_idx'),
      ).toContain('(user_id, submitted_at DESC)');
    });

    it('tiene el índice (status, submitted_at) para la cola del revisor', async () => {
      expect(
        await indexDef('identity_verifications_status_submitted_at_idx'),
      ).toContain('(status, submitted_at)');
    });

    it('el índice único de PENDIENTE es parcial', async () => {
      const def = await indexDef(
        'identity_verifications_one_pending_per_user_key',
      );
      expect(def).toContain('UNIQUE');
      expect(def).toContain("WHERE (status = 'PENDIENTE'");
    });

    it('devuelve primero la solicitud más reciente del usuario', async () => {
      const tenant = await newTenant();
      await prisma.identityVerification.create({
        data: decided(tenant.id, 'RECHAZADA'),
      });
      const latest = await prisma.identityVerification.create({
        data: { ...pending(tenant.id), submittedAt: REVIEWED },
      });

      const found = await prisma.identityVerification.findFirst({
        where: { userId: tenant.id },
        orderBy: { submittedAt: 'desc' },
      });
      expect(found?.id).toBe(latest.id);
    });
  });

  it('una persona está verificada si tiene alguna solicitud APROBADA', async () => {
    const [verified, rejected, waiting, none] = await Promise.all([
      newTenant(),
      newTenant(),
      newTenant(),
      newTenant(),
    ]);
    await prisma.identityVerification.create({ data: decided(verified.id) });
    await prisma.identityVerification.create({
      data: decided(rejected.id, 'RECHAZADA'),
    });
    await prisma.identityVerification.create({ data: pending(waiting.id) });

    const isVerified = async (userId: string) =>
      (await prisma.identityVerification.count({
        where: { userId, status: 'APROBADA' },
      })) > 0;

    expect(await isVerified(verified.id)).toBe(true);
    expect(await isVerified(rejected.id)).toBe(false);
    expect(await isVerified(waiting.id)).toBe(false);
    expect(await isVerified(none.id)).toBe(false);
  });
});
