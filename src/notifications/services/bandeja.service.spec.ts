import { NotFoundException } from '@nestjs/common';
import { BandejaService } from '@Notifications/services';
import type {
  NotificationRepository,
  NotificationRow,
} from '@Notifications/repositories';
import { ModuloOrigen } from '@Notifications/types';

const USUARIO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const NOTIFICACION = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const CREADA = new Date('2026-11-15T10:00:00.000Z');
const LEIDA = new Date('2026-11-15T12:30:00.000Z');

function fila(cambios: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: NOTIFICACION,
    sourceModule: ModuloOrigen.RESERVAS,
    title: 'Reserva CONFIRMADA',
    message: 'Tu reserva de «Taladro» fue confirmada.',
    referenceType: 'reserva',
    referenceId: 'r-1',
    readAt: null,
    createdAt: CREADA,
    ...cambios,
  };
}

describe('BandejaService', () => {
  let repo: {
    findPageByUser: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    countUnread: ReturnType<typeof vi.fn>;
  };
  let service: BandejaService;

  beforeEach(() => {
    repo = {
      findPageByUser: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      markAsRead: vi.fn(),
      countUnread: vi.fn(),
    };
    service = new BandejaService(repo as unknown as NotificationRepository);
  });

  describe('listar', () => {
    it('convierte page y limit en skip y take', async () => {
      await service.listar(USUARIO, {
        soloNoLeidas: false,
        page: 3,
        limit: 20,
      });
      expect(repo.findPageByUser).toHaveBeenCalledWith(USUARIO, {
        unreadOnly: false,
        skip: 40,
        take: 20,
      });
    });

    it('la primera página empieza en 0', async () => {
      await service.listar(USUARIO, { soloNoLeidas: true, page: 1, limit: 5 });
      expect(repo.findPageByUser).toHaveBeenCalledWith(USUARIO, {
        unreadOnly: true,
        skip: 0,
        take: 5,
      });
    });

    it('devuelve los items con los nombres del brief y el total del repositorio', async () => {
      repo.findPageByUser.mockResolvedValue({
        items: [fila({ readAt: LEIDA })],
        total: 7,
      });

      const bandeja = await service.listar(USUARIO, {
        soloNoLeidas: false,
        page: 1,
        limit: 1,
      });

      expect(bandeja).toEqual({
        items: [
          {
            id: NOTIFICACION,
            moduloOrigen: 'RESERVAS',
            titulo: 'Reserva CONFIRMADA',
            mensaje: 'Tu reserva de «Taladro» fue confirmada.',
            referencia: { tipo: 'reserva', id: 'r-1' },
            leidaAt: LEIDA,
            creadaAt: CREADA,
          },
        ],
        total: 7,
      });
    });

    it('un aviso sin referencia sale con referencia null', async () => {
      repo.findPageByUser.mockResolvedValue({
        items: [fila({ referenceType: null, referenceId: null })],
        total: 1,
      });
      const { items } = await service.listar(USUARIO, {
        soloNoLeidas: false,
        page: 1,
        limit: 20,
      });
      expect(items[0].referencia).toBeNull();
    });

    it('no expone el userId', async () => {
      repo.findPageByUser.mockResolvedValue({
        items: [{ ...fila(), userId: USUARIO }],
        total: 1,
      });
      const { items } = await service.listar(USUARIO, {
        soloNoLeidas: false,
        page: 1,
        limit: 20,
      });
      expect(items[0]).not.toHaveProperty('userId');
    });
  });

  describe('marcarLeida', () => {
    it('pide al repositorio la notificación del usuario y devuelve leidaAt', async () => {
      repo.markAsRead.mockResolvedValue(fila({ readAt: LEIDA }));

      const notificacion = await service.marcarLeida(USUARIO, NOTIFICACION);

      expect(repo.markAsRead).toHaveBeenCalledWith(NOTIFICACION, USUARIO);
      expect(notificacion).toMatchObject({ id: NOTIFICACION, leidaAt: LEIDA });
    });

    it('si ya estaba leída devuelve la fecha que trae el repositorio', async () => {
      const original = new Date('2026-11-01T08:00:00.000Z');
      repo.markAsRead.mockResolvedValue(fila({ readAt: original }));

      const notificacion = await service.marcarLeida(USUARIO, NOTIFICACION);
      expect(notificacion.leidaAt).toBe(original);
    });

    it('responde 404 si no existe o es de otro usuario', async () => {
      repo.markAsRead.mockResolvedValue(null);

      const error = await service
        .marcarLeida(USUARIO, NOTIFICACION)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({ message: 'La notificación no existe.' });
    });
  });

  describe('contarNoLeidas', () => {
    it('devuelve { noLeidas } del usuario', async () => {
      repo.countUnread.mockResolvedValue(3);

      await expect(service.contarNoLeidas(USUARIO)).resolves.toEqual({
        noLeidas: 3,
      });
      expect(repo.countUnread).toHaveBeenCalledWith(USUARIO);
    });
  });
});
