import { describe, expect, it, vi } from 'vitest';
import { AutenticacionService } from './autenticacion.service.js';
import type { ServicioPrisma } from '../prisma/prisma.service.js';

function preparar(rol: 'TURISTA' | 'ADMIN_DESTINO' = 'TURISTA') {
  const actualizar = vi.fn().mockResolvedValue({ count: 1 });
  const auditoria = vi.fn();
  const tx = {
    usuario: { updateMany: actualizar },
    auditoriaUsuario: { create: auditoria },
  };
  const servicio = new AutenticacionService({
    cliente: { $transaction: <T>(accion: (tx: unknown) => T) => accion(tx) },
  } as unknown as ServicioPrisma);
  vi.spyOn(servicio, 'validarSesion').mockResolvedValue({
    perfil: { id: 'mi-cuenta', rol, activo: true, nombreCompleto: 'Ana' },
    venceEn: new Date(),
  });
  return { servicio, actualizar, auditoria };
}

describe('Edición del perfil del visitante', () => {
  it('actualiza solo el nombre de la cuenta actual y registra la modificación', async () => {
    const { servicio, actualizar, auditoria } = preparar();
    await servicio.actualizarPerfilVisitante('token', 'Ana López');
    expect(actualizar).toHaveBeenCalledWith({
      where: {
        id: 'mi-cuenta',
        activo: true,
        rol: 'TURISTA',
        nombreCompleto: 'Ana',
      },
      data: { nombreCompleto: 'Ana López' },
    });
    expect(auditoria).toHaveBeenCalledOnce();
  });

  it('rechaza un cambio concurrente antes de registrar una auditoría', async () => {
    const { servicio, actualizar, auditoria } = preparar();
    actualizar.mockResolvedValue({ count: 0 });
    await expect(
      servicio.actualizarPerfilVisitante('token', 'Ana López'),
    ).rejects.toThrow('Tu perfil cambió');
    expect(auditoria).not.toHaveBeenCalled();
  });

  it('rechaza cuentas de otro rol en la edición del visitante', async () => {
    const { servicio, actualizar } = preparar('ADMIN_DESTINO');
    await expect(
      servicio.actualizarPerfilVisitante('token', 'Ana López'),
    ).rejects.toThrow();
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('conserva la edición existente del perfil del encargado', async () => {
    const { servicio, actualizar } = preparar('ADMIN_DESTINO');
    await servicio.actualizarPerfilAdmin('token', 'Ana López');
    expect(actualizar).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rol: 'ADMIN_DESTINO',
          id: 'mi-cuenta',
        }),
      }),
    );
  });
});
