import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prueba = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const cliente = {
    on: vi.fn((evento: string, accion: (...args: any[]) => void) => {
      handlers.set(evento, accion);
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    handlers,
    cliente,
    construir: vi.fn(function () {
      return cliente;
    }),
  };
});
vi.mock('pg', () => ({ Client: prueba.construir }));
vi.mock('../prisma/configuracion-postgres.js', () => ({
  configuracionPostgres: () => ({ connectionString: 'postgresql://prueba' }),
}));
import { EventosVisitasService } from './eventos-visitas.service.js';

const propio = '11111111-1111-4111-8111-111111111111';
const ajeno = '22222222-2222-4222-8222-222222222222';
let servicio: EventosVisitasService;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  prueba.handlers.clear();
  vi.stubEnv('DIRECT_URL', 'postgresql://prueba:5432/base');
  servicio = new EventosVisitasService();
});
afterEach(async () => {
  await servicio.onModuleDestroy();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function conectar() {
  servicio.onModuleInit();
  await vi.advanceTimersByTimeAsync(0);
}

describe('Canal de actividad de visitas', () => {
  it('publica disponibilidad y escucha un solo canal sin exponer credenciales', async () => {
    const mensajes: unknown[] = [];
    const suscripcion = servicio
      .observar(propio)
      .subscribe((valor) => mensajes.push(valor));
    await conectar();
    expect(prueba.cliente.query).toHaveBeenCalledWith('LISTEN munay_visitas');
    expect(mensajes).toContainEqual({
      type: 'estado',
      data: { conectado: true },
    });
    suscripcion.unsubscribe();
  });
  it('solo avisa del destino autorizado y agrupa cambios concurrentes', async () => {
    const mensajes: unknown[] = [];
    const suscripcion = servicio
      .observar(propio)
      .subscribe((valor) => mensajes.push(valor));
    await conectar();
    const notificar = prueba.handlers.get('notification')!;
    notificar({ channel: 'munay_visitas', payload: ajeno });
    notificar({ channel: 'munay_visitas', payload: 'invalido' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mensajes).not.toContainEqual({
      type: 'actualizacion',
      data: { actualizar: true },
    });
    notificar({ channel: 'munay_visitas', payload: propio });
    notificar({ channel: 'munay_visitas', payload: propio });
    await vi.advanceTimersByTimeAsync(100);
    expect(
      mensajes.filter((mensaje: any) => mensaje.type === 'actualizacion'),
    ).toEqual([{ type: 'actualizacion', data: { actualizar: true } }]);
    suscripcion.unsubscribe();
  });
  it('cierra el flujo antes del límite de ejecución y cancela sus temporizadores', async () => {
    const completar = vi.fn();
    servicio.observar(propio).subscribe({ complete: completar });
    await vi.advanceTimersByTimeAsync(45000);
    expect(completar).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('informa la caída y reconecta el canal', async () => {
    const mensajes: unknown[] = [];
    const suscripcion = servicio
      .observar(propio)
      .subscribe((valor) => mensajes.push(valor));
    await conectar();
    prueba.handlers.get('error')!(new Error('desconexión'));
    expect(mensajes.at(-1)).toEqual({
      type: 'estado',
      data: { conectado: false },
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(prueba.construir).toHaveBeenCalledTimes(2);
    expect(mensajes.at(-1)).toEqual({
      type: 'estado',
      data: { conectado: true },
    });
    suscripcion.unsubscribe();
  });
  it('libera los flujos y temporizadores al cerrar el módulo', async () => {
    const completar = vi.fn();
    servicio.observar(propio).subscribe({ complete: completar });
    await conectar();
    await servicio.onModuleDestroy();
    expect(completar).toHaveBeenCalledOnce();
    expect(prueba.cliente.end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('no usa el pool transaccional para escuchar eventos', async () => {
    vi.stubEnv('DIRECT_URL', 'postgresql://prueba:6543/base');
    await conectar();
    expect(prueba.construir).not.toHaveBeenCalled();
  });
});
