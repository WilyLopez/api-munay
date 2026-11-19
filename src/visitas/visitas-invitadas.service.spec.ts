import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServicioPrisma } from '../prisma/prisma.service.js';
import { VisitasService } from './visitas.service.js';
import { VisitasInvitadasService } from './visitas-invitadas.service.js';

const token = 'a'.repeat(64);
const destino = {
  id: 'destino',
  nombre: 'Museo',
  slug: 'museo',
  imagenUrl: null,
  estadoEditorial: 'publicada',
  latitud: -6.7,
  longitud: -79.8,
};
const codigo = {
  id: 'codigo',
  destino,
  venceEn: new Date(Date.now() + 60000),
  usadoEn: null,
  anuladoEn: null,
};
function preparar() {
  const invitada = {
    id: 'invitada',
    codigoId: codigo.id,
    usuarioId: null as string | null,
    verificadaEn: new Date(),
    venceEn: new Date(Date.now() + 86400000),
    codigo: { destino },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    destino: { count: vi.fn().mockResolvedValue(1) },
    codigoVisita: { findUnique: vi.fn().mockResolvedValue(codigo) },
    visitaInvitada: {
      findUnique: vi.fn().mockResolvedValue(invitada),
      update: vi.fn().mockResolvedValue(invitada),
      upsert: vi.fn().mockResolvedValue(invitada),
    },
    permisoVisita: { upsert: vi.fn().mockResolvedValue({}) },
    visitaVerificada: { upsert: vi.fn().mockResolvedValue({ id: 'visita' }) },
  };
  const cliente = {
    ...tx,
    $transaction: <T>(accion: (valor: typeof tx) => Promise<T>) => accion(tx),
  };
  const visitas = { obtenerCodigoVisita: vi.fn().mockResolvedValue(codigo) };
  const servicio = new VisitasInvitadasService(
    { cliente } as unknown as ServicioPrisma,
    visitas as unknown as VisitasService,
  );
  return { servicio, tx, invitada };
}
beforeEach(() => vi.restoreAllMocks());
describe('Visitas de invitados', () => {
  it('guarda solamente el hash del token y concede cinco minutos para confirmar ubicación', async () => {
    const { servicio, tx } = preparar();
    tx.visitaInvitada.findUnique.mockResolvedValue(null);
    const antes = Date.now();
    await expect(
      servicio.preparar(token, 'codigo', 'museo'),
    ).resolves.toHaveProperty('estado', 'ubicacion');
    const guardada = tx.visitaInvitada.upsert.mock.calls[0][0];
    expect(guardada.create.tokenHash).not.toBe(token);
    expect(guardada.create.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(guardada.create.venceEn.getTime()).toBeGreaterThanOrEqual(
      antes + 300000,
    );
    expect(guardada.create.verificadaEn).toBeNull();
  });
  it('no emite un permiso nuevo para un QR vencido', async () => {
    const { servicio, tx } = preparar();
    tx.visitaInvitada.findUnique.mockResolvedValue(null);
    tx.codigoVisita.findUnique.mockResolvedValue({
      ...codigo,
      venceEn: new Date(0),
    });
    await expect(servicio.preparar(token, 'codigo', 'museo')).rejects.toThrow(
      'expiró',
    );
    expect(tx.visitaInvitada.upsert).not.toHaveBeenCalled();
  });
  it('transfiere el permiso al identificarse antes de comprobar ubicación sin inventar una visita', async () => {
    const { servicio, tx, invitada } = preparar();
    invitada.verificadaEn = null as unknown as Date;
    invitada.venceEn = new Date(Date.now() + 120000);
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).resolves.toEqual({ visitaId: null, slug: 'museo' });
    expect(tx.permisoVisita.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          codigoId: codigo.id,
          usuarioId: 'usuario',
          venceEn: invitada.venceEn,
        },
        update: { venceEn: invitada.venceEn },
      }),
    );
    expect(tx.visitaVerificada.upsert).not.toHaveBeenCalled();
    expect(tx.visitaInvitada.update).toHaveBeenCalledWith({
      where: { id: invitada.id },
      data: { usuarioId: 'usuario' },
    });
  });
  it('no transfiere un permiso pendiente que ya venció', async () => {
    const { servicio, tx, invitada } = preparar();
    invitada.verificadaEn = null as unknown as Date;
    invitada.venceEn = new Date(0);
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).rejects.toThrow('venció');
    expect(tx.permisoVisita.upsert).not.toHaveBeenCalled();
  });
  it('identifica una visita temporal ya verificada sin crear otra ni cambiar su fecha', async () => {
    const { servicio, tx, invitada } = preparar();
    await expect(
      servicio.preparar(token, 'codigo', 'museo'),
    ).resolves.toMatchObject({
      estado: 'verificada',
      datos: {
        yaVerificada: true,
        visita: { id: invitada.id, verificadaEn: invitada.verificadaEn },
      },
    });
    expect(tx.visitaInvitada.upsert).not.toHaveBeenCalled();
    expect(tx.visitaInvitada.update).not.toHaveBeenCalled();
  });
  it('rechaza tokens inválidos antes de consultar la base', async () => {
    const { servicio, tx } = preparar();
    await expect(servicio.estado('inseguro', 'museo')).rejects.toThrow(
      'no es válida',
    );
    expect(tx.visitaInvitada.findUnique).not.toHaveBeenCalled();
  });
  it('conserva la fecha y no duplica una visita al asociarla a la cuenta', async () => {
    const { servicio, tx, invitada } = preparar();
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).resolves.toEqual({ visitaId: 'visita', slug: 'museo' });
    expect(tx.visitaVerificada.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          verificadaEn: invitada.verificadaEn,
        }),
        update: {},
      }),
    );
    invitada.usuarioId = 'usuario';
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).resolves.toHaveProperty('visitaId');
  });
  it('impide que otra cuenta se apropie de una verificación asociada', async () => {
    const { servicio, invitada, tx } = preparar();
    invitada.usuarioId = 'otro';
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).rejects.toThrow('otra cuenta');
    expect(tx.visitaVerificada.upsert).not.toHaveBeenCalled();
  });
  it('rechaza pruebas vencidas y cuentas administrativas', async () => {
    const { servicio, invitada } = preparar();
    invitada.venceEn = new Date(0);
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'TURISTA' }),
    ).rejects.toThrow('venció');
    await expect(
      servicio.reclamar(token, { id: 'usuario', rol: 'ADMIN_DESTINO' }),
    ).rejects.toThrow('visitante');
  });
  it('permite completar la ubicación después de renovar el QR si el permiso sigue vigente', async () => {
    const { servicio, invitada, tx } = preparar();
    invitada.verificadaEn = null as unknown as Date;
    tx.visitaInvitada.update.mockResolvedValue({
      ...invitada,
      verificadaEn: new Date(),
    });
    const respuesta = await servicio.verificar(token, 'codigo', 'museo', {
      latitud: -6.7,
      longitud: -79.8,
      precision: 10,
    });
    expect(respuesta.geocerca.distanciaMetros).toBe(0);
    expect(tx.codigoVisita.findUnique).not.toHaveBeenCalled();
  });
  it('no verifica al visitante fuera del radio ni concede visitas a otro destino', async () => {
    const { servicio, tx } = preparar();
    await expect(
      servicio.verificar(token, 'codigo', 'museo', {
        latitud: -7.7,
        longitud: -79.8,
        precision: 10,
      }),
    ).rejects.toThrow();
    expect(tx.visitaInvitada.update).not.toHaveBeenCalled();
    await expect(servicio.estado(token, 'otro')).rejects.toThrow(
      'no está disponible',
    );
  });
});
