import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import type { AutenticacionService } from '../autenticacion/autenticacion.service.js';
import type { VisitasInvitadasService } from './visitas-invitadas.service.js';
import type { EventosVisitasService } from './eventos-visitas.service.js';
import { VisitasController } from './visitas.controller.js';
import { VisitasService } from './visitas.service.js';

describe('Autorización de eventos de visitas', () => {
  it('rechaza al visitante antes de consultar el destino', async () => {
    const findFirst = vi.fn();
    const servicio = new VisitasService({
      cliente: { destino: { findFirst } },
    } as unknown as ServicioPrisma);
    await expect(
      servicio.autorizarEventos({ id: 'usuario', rol: 'TURISTA' }, 'museo'),
    ).rejects.toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('limita al encargado a su destino asignado', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'destino-propio' })
      .mockResolvedValueOnce(null);
    const servicio = new VisitasService({
      cliente: { destino: { findFirst } },
    } as unknown as ServicioPrisma);
    await expect(
      servicio.autorizarEventos(
        { id: 'encargado', rol: 'ADMIN_DESTINO' },
        'museo',
      ),
    ).resolves.toBe('destino-propio');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: 'museo',
          administradores: { some: { usuarioId: 'encargado' } },
        },
      }),
    );
    await expect(
      servicio.autorizarEventos(
        { id: 'encargado', rol: 'ADMIN_DESTINO' },
        'ajeno',
      ),
    ).rejects.toThrow('no está disponible');
  });
  it('no abre el canal sin una sesión válida', async () => {
    const observar = vi.fn();
    const controlador = new VisitasController(
      {
        validarSesion: vi.fn().mockRejectedValue(new UnauthorizedException()),
      } as unknown as AutenticacionService,
      {} as VisitasService,
      {} as VisitasInvitadasService,
      { observar } as unknown as EventosVisitasService,
    );
    await expect(controlador.escucharEventos('museo')).rejects.toThrow();
    expect(observar).not.toHaveBeenCalled();
  });
});
