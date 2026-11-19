import { describe, expect, it, vi } from 'vitest';
import { DestinosService } from './destinos.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

const perfil = { id: 'encargado', rol: 'ADMIN_DESTINO' } as const;
const ficha = {
  actualizadoEn: new Date('2026-11-19T12:00:00Z'),
  estadoEditorial: 'borrador',
  nombre: 'Museo de prueba',
  descripcion: 'Un museo de prueba con historia regional.',
  ubicacion: 'Lambayeque, Perú',
  categoria: 'CULTURA',
  provincia: 'LAMBAYEQUE',
  latitud: -6.7,
  longitud: -79.8,
  imagenUrl: '/museo.jpg',
  informacion: {
    distrito: 'Lambayeque',
    condicion: 'abierto',
    modalidadIngreso: 'libre',
  },
  tarifaGeneral: null,
  tarifaEstudiantes: null,
};

function preparar() {
  const destino = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findFirst: vi.fn().mockResolvedValue(ficha),
  };
  const servicio = new DestinosService({
    cliente: { destino },
  } as unknown as ServicioPrisma);
  return { servicio, destino };
}

describe('Visibilidad del atractivo asignado', () => {
  it('deshabilita únicamente la publicación asignada al encargado', async () => {
    const { servicio, destino } = preparar();
    destino.findFirst.mockResolvedValue({
      ...ficha,
      estadoEditorial: 'publicada',
    });
    await servicio.cambiarVisibilidad('museo', perfil, false);
    expect(destino.updateMany).toHaveBeenCalledWith({
      where: {
        slug: 'museo',
        administradores: { some: { usuarioId: perfil.id } },
        estadoEditorial: 'publicada',
        actualizadoEn: ficha.actualizadoEn,
      },
      data: { estadoEditorial: 'borrador' },
    });
  });

  it('publica únicamente el borrador asignado al encargado', async () => {
    const { servicio, destino } = preparar();
    await servicio.cambiarVisibilidad('museo', perfil, true);
    expect(destino.updateMany).toHaveBeenCalledWith({
      where: {
        slug: 'museo',
        administradores: { some: { usuarioId: perfil.id } },
        estadoEditorial: 'borrador',
        actualizadoEn: ficha.actualizadoEn,
      },
      data: { estadoEditorial: 'publicada', verificado: false },
    });
  });

  it('rechaza cambios sobre un atractivo ajeno', async () => {
    const { servicio, destino } = preparar();
    destino.updateMany.mockResolvedValue({ count: 0 });
    destino.findFirst.mockResolvedValue(null);
    await expect(
      servicio.cambiarVisibilidad('ajeno', perfil, true),
    ).rejects.toThrow('El atractivo no está disponible para tu cuenta.');
  });

  it('no publica una ficha archivada', async () => {
    const { servicio, destino } = preparar();
    destino.updateMany.mockResolvedValue({ count: 0 });
    destino.findFirst.mockResolvedValue({ estadoEditorial: 'archivada' });
    await expect(
      servicio.cambiarVisibilidad('museo', perfil, true),
    ).rejects.toThrow('La ficha está en revisión o archivada.');
  });

  it('acepta reintentos cuando ya tiene la visibilidad solicitada', async () => {
    const { servicio, destino } = preparar();
    destino.updateMany.mockResolvedValue({ count: 0 });
    destino.findFirst.mockResolvedValue({ estadoEditorial: 'publicada' });
    await expect(
      servicio.cambiarVisibilidad('museo', perfil, true),
    ).resolves.toBeUndefined();
  });

  it('rechaza cuentas de turista y valores distintos de booleanos', async () => {
    const { servicio, destino } = preparar();
    await expect(
      servicio.cambiarVisibilidad(
        'museo',
        { id: 'turista', rol: 'TURISTA' },
        true,
      ),
    ).rejects.toThrow();
    await expect(
      servicio.cambiarVisibilidad('museo', perfil, 'true'),
    ).rejects.toThrow();
    expect(destino.updateMany).not.toHaveBeenCalled();
  });
});
