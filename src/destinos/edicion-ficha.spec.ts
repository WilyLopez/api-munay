import { describe, it, expect, vi } from 'vitest';
import { DestinosService } from './destinos.service.js';
import {
  validarInformacion,
  validarCoherenciaFicha,
} from './informacion-destino.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

const version = '2026-11-19T12:00:00.000Z';
const perfil = { id: 'encargado', rol: 'ADMIN_DESTINO' } as const;
function preparar() {
  const ficha = {
    id: '11111111-1111-4111-8111-111111111111',
    actualizadoEn: new Date(version),
    estadoEditorial: 'borrador',
    imagenUrl: null,
    fotosAdicionales: [],
    informacion: {},
    tarifaGeneral: null,
    tarifaEstudiantes: null,
  };
  const destino = {
    findFirst: vi.fn().mockResolvedValue(ficha),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(1),
  };
  const servicio = new DestinosService({
    cliente: { destino },
  } as unknown as ServicioPrisma);
  return { servicio, destino, ficha };
}
describe('Edición protegida de la ficha', () => {
  it('requiere la versión y rechaza cambios desde una pestaña antigua', async () => {
    const { servicio, destino } = preparar();
    await expect(
      servicio.actualizarFichaOperativa('museo', perfil, { horario: null }),
    ).rejects.toThrow('versión');
    await expect(
      servicio.actualizarFichaOperativa('museo', perfil, {
        version: '2026-11-18T12:00:00Z',
        horario: null,
      }),
    ).rejects.toThrow('cambió');
    expect(destino.updateMany).not.toHaveBeenCalled();
  });
  it('comprueba el alcance y usa una condición atómica de versión', async () => {
    const { servicio, destino } = preparar();
    await servicio.actualizarFichaOperativa('museo', perfil, {
      version,
      horario: null,
      tarifaGeneral: null,
      tarifaEstudiantes: null,
    });
    expect(destino.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          slug: 'museo',
          administradores: { some: { usuarioId: perfil.id } },
          actualizadoEn: new Date(version),
          estadoEditorial: { in: ['borrador', 'publicada'] },
        },
      }),
    );
    destino.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      servicio.actualizarFichaOperativa('museo', perfil, {
        version,
        horario: null,
        tarifaGeneral: null,
        tarifaEstudiantes: null,
      }),
    ).rejects.toThrow('cambió');
  });
  it('no permite publicar un borrador incompleto', async () => {
    const { servicio, destino } = preparar();
    await expect(
      servicio.cambiarVisibilidad('museo', perfil, true),
    ).rejects.toThrow();
    expect(destino.updateMany).not.toHaveBeenCalled();
  });
  it('no permite borrar requisitos de una ficha publicada', async () => {
    const { servicio, destino, ficha } = preparar();
    destino.findFirst.mockResolvedValue({
      ...ficha,
      estadoEditorial: 'publicada',
    });
    await expect(
      servicio.actualizarFichaOperativa('museo', perfil, {
        version,
        horario: null,
        informacion: {},
      }),
    ).rejects.toThrow('Completa');
    expect(destino.updateMany).not.toHaveBeenCalled();
  });
  it('rechaza destinos ajenos antes de escribir y cuentas de turista', async () => {
    const { servicio, destino } = preparar();
    destino.findFirst.mockResolvedValue(null);
    await expect(
      servicio.actualizarFichaOperativa('ajeno', perfil, { version }),
    ).rejects.toThrow('cuenta');
    await expect(
      servicio.actualizarFichaOperativa(
        'museo',
        { id: 'turista', rol: 'TURISTA' },
        { version },
      ),
    ).rejects.toThrow();
    expect(destino.updateMany).not.toHaveBeenCalled();
  });
});
describe('Coherencia de la información turística', () => {
  it('valida dominios de redes e impide dominios parecidos', () => {
    expect(
      validarInformacion({ instagram: 'https://www.instagram.com/museo' }),
    ).toHaveProperty('instagram');
    for (const instagram of [
      'https://instagram.com.ejemplo.com/museo',
      'https://otro.com',
      'http://instagram.com/museo',
    ])
      expect(() => validarInformacion({ instagram })).toThrow();
  });
  it('exige mensajes y fechas completas para los avisos', () => {
    for (const aviso of [
      { avisoDesde: '2026-11-20' },
      { aviso: 'Mensaje' },
      { aviso: 'Mensaje', avisoDesde: '2026-12-01', avisoHasta: '2026-11-20' },
    ])
      expect(() => validarInformacion(aviso)).toThrow();
    expect(
      validarInformacion({
        aviso: 'Cierre',
        avisoDesde: '2026-11-20',
        avisoHasta: '2026-11-21',
      }),
    ).toHaveProperty('aviso', 'Cierre');
  });
  it('rechaza tarifas en entrada libre y exige tarifa positiva al publicar ingreso de pago', () => {
    expect(() =>
      validarCoherenciaFicha({ modalidadIngreso: 'libre' }, '10', null),
    ).toThrow();
    expect(() =>
      validarCoherenciaFicha({ modalidadIngreso: 'pago' }, null, null, true),
    ).toThrow();
    expect(() =>
      validarCoherenciaFicha({ modalidadIngreso: 'pago' }, '10.50', null, true),
    ).not.toThrow();
  });
  it('solicita contacto de reserva y motivo para cierre o restricción', () => {
    expect(() =>
      validarCoherenciaFicha({ modalidadIngreso: 'reserva' }, null, null),
    ).toThrow();
    expect(() =>
      validarCoherenciaFicha(
        { modalidadIngreso: 'reserva', correo: 'museo@example.com' },
        null,
        null,
      ),
    ).not.toThrow();
    expect(() =>
      validarCoherenciaFicha({ condicion: 'cerrado' }, null, null),
    ).toThrow();
    expect(() =>
      validarCoherenciaFicha(
        { condicion: 'abierto', reapertura: '2026-12-01' },
        null,
        null,
      ),
    ).toThrow();
  });
});
