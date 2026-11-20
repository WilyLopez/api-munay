import { describe, expect, it, vi } from 'vitest';
import { BeneficiosService, datosBeneficio } from './beneficios.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

const usuario = {
  id: '11111111-1111-4111-8111-111111111111',
  rol: 'TURISTA',
} as const;
const encargado = {
  id: '22222222-2222-4222-8222-222222222222',
  rol: 'ADMIN_DESTINO',
} as const;
const beneficioId = '33333333-3333-4333-8333-333333333333';
const solicitudId = '44444444-4444-4444-8444-444444444444';
const destino = {
  id: '55555555-5555-4555-8555-555555555555',
  nombre: 'Destino de prueba',
  slug: 'prueba',
};
const oferta = {
  id: beneficioId,
  destinoId: destino.id,
  nombre: 'Beneficio de prueba',
  local: 'Local de prueba',
  categoria: 'EXPERIENCIAS',
  condiciones: 'Solo para la prueba automatizada.',
  horario: 'Martes a domingo',
  costo: 30,
  disponibles: 1,
  activo: true,
  revision: 1,
  unUso: true,
  venceEn: new Date('2099-12-31T23:59:59Z'),
};
function preparar() {
  const creado = {
    id: solicitudId,
    beneficioId,
    usuarioId: usuario.id,
    nombre: oferta.nombre,
    local: oferta.local,
    condiciones: oferta.condiciones,
    horario: oferta.horario,
    costo: 30,
    codigo: 'A'.repeat(32),
    venceEn: oferta.venceEn,
    creadoEn: new Date(),
    usadoEn: null,
    usadoPor: null,
    beneficio: { destino },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditoriaBeneficio: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    beneficio: {
      findFirst: vi.fn().mockResolvedValue({ ...oferta }),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: beneficioId }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    destino: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ ...destino, estadoEditorial: 'publicada' }),
    },
    canjeBeneficio: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(creado),
      findFirst: vi.fn().mockResolvedValue(creado),
      update: vi.fn(),
    },
    movimientoPuntos: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { puntos: 50 } }),
      create: vi.fn(),
    },
  };
  const servicio = new BeneficiosService({
    cliente: {
      ...tx,
      $transaction: <T>(accion: (cliente: unknown) => Promise<T>) => accion(tx),
    },
  } as unknown as ServicioPrisma);
  return { servicio, tx, creado };
}
const esperado = { costo: 30, version: 1 };
describe('Canjes de beneficios', () => {
  it('permite al encargado pausar sin cambiar las condiciones de los comprobantes', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.findFirst.mockResolvedValue({
      ...oferta,
      estado: 'publicado',
      aprobadoRevision: 1,
      aprobadoEn: new Date(),
      destino: { estadoEditorial: 'publicada' },
    });
    await servicio.cambiarEstado(encargado, beneficioId, 'pausar', 1);
    expect(tx.beneficio.update).toHaveBeenCalledWith({
      where: { id: beneficioId },
      data: {
        activo: false,
        estado: 'pausado',
        revision: { increment: 1 },
        aprobadoRevision: 2,
      },
    });
    expect(tx.canjeBeneficio.update).not.toHaveBeenCalled();
    expect(tx.auditoriaBeneficio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: encargado.id,
          accion: 'pausar',
        }),
      }),
    );
  });
  it('no permite reanudar condiciones que no conservan aprobación vigente', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.findFirst.mockResolvedValue({
      ...oferta,
      estado: 'pausado',
      aprobadoRevision: 0,
      aprobadoEn: new Date(),
      destino: { estadoEditorial: 'publicada' },
    });
    await expect(
      servicio.cambiarEstado(encargado, beneficioId, 'reanudar', 1),
    ).rejects.toThrow('aprobar');
    expect(tx.beneficio.update).not.toHaveBeenCalled();
  });
  it('no permite pausar un atractivo ajeno ni actuar con una versión anterior', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.findFirst.mockResolvedValueOnce(null);
    await expect(
      servicio.cambiarEstado(encargado, beneficioId, 'pausar', 1),
    ).rejects.toThrow('no está disponible');
    await expect(
      servicio.cambiarEstado(encargado, beneficioId, 'pausar', 0),
    ).rejects.toThrow('cambió');
  });
  it('conserva el borrador del encargado sin aprobación y registra su autor', async () => {
    const { servicio, tx } = preparar();
    await servicio.guardar(encargado, {
      ...oferta,
      estado: 'borrador',
      venceEn: oferta.venceEn.toISOString(),
    });
    expect(tx.beneficio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'borrador',
          activo: false,
          aprobadoRevision: null,
        }),
      }),
    );
    expect(tx.auditoriaBeneficio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: encargado.id,
          accion: 'crear',
        }),
      }),
    );
  });
  it('permite publicar solamente al SuperAdmin y guarda la aprobación de esa revisión', async () => {
    const { servicio, tx } = preparar();
    await servicio.guardar(
      { ...encargado, rol: 'SUPER_ADMIN' },
      { ...oferta, venceEn: oferta.venceEn.toISOString() },
    );
    expect(tx.beneficio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'publicado',
          activo: true,
          aprobadoRevision: 1,
          aprobadoEn: expect.any(Date),
        }),
      }),
    );
  });
  it('respeta un límite configurable de dos canjes por persona', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.findFirst.mockResolvedValue({
      ...oferta,
      limitePorPersona: 2,
      unUso: false,
    });
    tx.canjeBeneficio.count.mockResolvedValue(2);
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('2 canjes');
    expect(tx.canjeBeneficio.create).not.toHaveBeenCalled();
  });
  it('impide canjear una oferta programada antes de su fecha de inicio', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.findFirst.mockResolvedValue({
      ...oferta,
      iniciaEn: new Date('2098-01-01'),
    });
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('no está disponible');
  });
  it('bloquea cuenta y oferta y registra un solo descuento y una sola reserva', async () => {
    const { servicio, tx } = preparar();
    tx.movimientoPuntos.aggregate
      .mockResolvedValueOnce({ _sum: { puntos: 50 } })
      .mockResolvedValueOnce({ _sum: { puntos: 20 } });
    const resultado = await servicio.canjear(
      usuario,
      beneficioId,
      solicitudId,
      esperado,
    );
    expect(resultado).toMatchObject({
      id: solicitudId,
      saldo: 20,
      estado: 'disponible',
    });
    expect(resultado).not.toHaveProperty('usuarioId');
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('usuarios');
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('beneficios');
    expect(tx.beneficio.update).toHaveBeenCalledWith({
      where: { id: beneficioId },
      data: { disponibles: { decrement: 1 } },
    });
    expect(tx.movimientoPuntos.create).toHaveBeenCalledWith({
      data: {
        usuarioId: usuario.id,
        canjeId: solicitudId,
        tipo: 'canje',
        puntos: -30,
      },
    });
    expect(tx.canjeBeneficio.create.mock.calls[0][0].data.codigo).toMatch(
      /^[A-F0-9]{32}$/,
    );
  });
  it('recupera el mismo comprobante al repetir una solicitud, sin otro descuento', async () => {
    const { servicio, tx, creado } = preparar();
    tx.canjeBeneficio.findUnique.mockResolvedValue(creado);
    expect(
      await servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).toMatchObject({ id: solicitudId });
    expect(tx.movimientoPuntos.create).not.toHaveBeenCalled();
    expect(tx.beneficio.update).not.toHaveBeenCalled();
  });
  it('no permite reutilizar la solicitud de otra persona', async () => {
    const { servicio, tx, creado } = preparar();
    tx.canjeBeneficio.findUnique.mockResolvedValue({
      ...creado,
      usuarioId: 'otra',
    });
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('ya fue utilizada');
  });
  it.each([{ disponibles: 0 }, { venceEn: new Date('2020-01-01') }])(
    'no descuenta ante oferta agotada o vencida: %j',
    async (cambios) => {
      const { servicio, tx } = preparar();
      tx.beneficio.findFirst.mockResolvedValue({ ...oferta, ...cambios });
      await expect(
        servicio.canjear(usuario, beneficioId, solicitudId, esperado),
      ).rejects.toThrow('no está disponible');
      expect(tx.movimientoPuntos.create).not.toHaveBeenCalled();
    },
  );
  it('no descuenta si el costo o las condiciones cambiaron después de abrir la confirmación', async () => {
    const { servicio, tx } = preparar();
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, {
        costo: 10,
        version: 1,
      }),
    ).rejects.toThrow('cambió');
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, {
        costo: 30,
        version: 2,
      }),
    ).rejects.toThrow('cambió');
    expect(tx.movimientoPuntos.create).not.toHaveBeenCalled();
  });
  it('comprueba saldo actual y uso por persona antes de emitir un comprobante', async () => {
    const { servicio, tx } = preparar();
    tx.movimientoPuntos.aggregate.mockResolvedValue({ _sum: { puntos: 20 } });
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('Te faltan 10');
    tx.canjeBeneficio.count.mockResolvedValue(1);
    await expect(
      servicio.canjear(usuario, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('un solo canje');
    expect(tx.canjeBeneficio.create).not.toHaveBeenCalled();
  });
  it('reserva los canjes para turistas', async () => {
    const { servicio } = preparar();
    await expect(
      servicio.canjear(encargado, beneficioId, solicitudId, esperado),
    ).rejects.toThrow('visitantes');
  });
  it('rechaza un comprobante ya utilizado sin volver a validarlo', async () => {
    const { servicio, tx, creado } = preparar();
    tx.canjeBeneficio.findFirst.mockResolvedValue({
      ...creado,
      usadoEn: new Date(),
    });
    await expect(servicio.usar(encargado, creado.codigo, true)).rejects.toThrow(
      'ya fue utilizado',
    );
    expect(tx.canjeBeneficio.update).not.toHaveBeenCalled();
  });
  it('solo permite comprobar códigos del destino autorizado y no consume al consultar', async () => {
    const { servicio, tx, creado } = preparar();
    await servicio.usar(encargado, creado.codigo, false);
    expect(tx.canjeBeneficio.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          codigo: creado.codigo,
          beneficio: {
            destino: { administradores: { some: { usuarioId: encargado.id } } },
          },
        },
      }),
    );
    expect(tx.canjeBeneficio.update).not.toHaveBeenCalled();
    await servicio.usar(encargado, creado.codigo, true);
    expect(tx.canjeBeneficio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { usadoEn: expect.any(Date), usadoPor: encargado.id },
      }),
    );
  });
  it('mantiene una propuesta del encargado deshabilitada aunque envíe activo=true', async () => {
    const { servicio, tx } = preparar();
    await servicio.guardar(encargado, {
      ...oferta,
      venceEn: oferta.venceEn.toISOString(),
    });
    expect(tx.beneficio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activo: false }),
      }),
    );
  });
  it('no restaura cupos consumidos mientras un encargado editaba la oferta', async () => {
    const { servicio, tx } = preparar();
    tx.beneficio.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      servicio.guardar(
        encargado,
        { ...oferta, venceEn: oferta.venceEn.toISOString(), stockActual: 1 },
        beneficioId,
      ),
    ).rejects.toThrow('cupos cambiaron');
  });
  it('valida costo, cupos y condiciones sin crear ofertas', () => {
    expect(() =>
      datosBeneficio({
        ...oferta,
        venceEn: oferta.venceEn.toISOString(),
        costo: -1,
      }),
    ).toThrow('costo');
    expect(() =>
      datosBeneficio({
        ...oferta,
        venceEn: oferta.venceEn.toISOString(),
        disponibles: -1,
      }),
    ).toThrow('disponibles');
    expect(() =>
      datosBeneficio({
        ...oferta,
        venceEn: oferta.venceEn.toISOString(),
        condiciones: '',
      }),
    ).toThrow('condiciones');
  });
});

it('informa el horario al consultar y bloquea la entrega sin consumir ni auditar', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T15:00:00Z'));
  try {
    const { servicio, tx, creado } = preparar();
    tx.canjeBeneficio.findFirst.mockResolvedValue({ ...creado, detalle: { dias: [5], horaInicio: '11:00', horaFin: '12:00' } } as typeof creado);
    const resultado = await servicio.usar(encargado, 'A'.repeat(32), false);
    expect(resultado.puedeEntregar).toBe(false);
    expect(resultado.aviso).toContain('horario');
    await expect(servicio.usar(encargado, 'A'.repeat(32), true)).rejects.toThrow('horario');
    expect(tx.canjeBeneficio.update).not.toHaveBeenCalled();
    expect(tx.auditoriaBeneficio.create).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('confirma una entrega vigente y registra el responsable y su auditoría', async () => {
  const { servicio, tx } = preparar();
  const resultado = await servicio.usar(encargado, 'A'.repeat(32), true);
  expect(resultado.estado).toBe('usado');
  expect(resultado.puedeEntregar).toBe(false);
  expect(tx.canjeBeneficio.update).toHaveBeenCalledWith({ where: { id: solicitudId }, data: { usadoEn: expect.any(Date), usadoPor: encargado.id } });
  expect(tx.auditoriaBeneficio.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accion: 'entregar', actorId: encargado.id, canjeId: solicitudId }) }));
});

it('un comprobante vencido nunca se entrega ni produce auditoría de entrega', async () => {
  const { servicio, tx, creado } = preparar();
  tx.canjeBeneficio.findFirst.mockResolvedValue({ ...creado, venceEn: new Date('2000-01-01') });
  await expect(servicio.usar(encargado, 'A'.repeat(32), true)).rejects.toThrow('venció');
  expect(tx.canjeBeneficio.update).not.toHaveBeenCalled();
  expect(tx.auditoriaBeneficio.create).not.toHaveBeenCalled();
});
