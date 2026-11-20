import { describe, expect, it } from 'vitest';
import {
  configuracionBeneficio,
  estadoBeneficio,
  filtroEstado,
  validarHorarioUso,
} from './configuracion-beneficio.js';
const vence = new Date('2099-12-31');
describe('Configuración de beneficios', () => {
  it('separa los puntos del porcentaje y conserva los importes en céntimos', () => {
    expect(
      configuracionBeneficio(
        { tipo: 'PORCENTAJE', valor: 10, costo: 30 },
        vence,
      ),
    ).toMatchObject({ tipo: 'PORCENTAJE', valor: 10 });
    expect(
      configuracionBeneficio(
        { tipo: 'IMPORTE', valor: 2500, consumoMinimo: 5000 },
        vence,
      ),
    ).toMatchObject({ tipo: 'IMPORTE', valor: 2500, consumoMinimo: 5000 });
  });
  it.each([
    { tipo: 'PORCENTAJE', valor: 101 },
    { tipo: 'PORCENTAJE' },
    { tipo: 'IMPORTE', valor: -1 },
    { dias: [8] },
    { dias: [1, 1] },
    { horaInicio: '12:00', horaFin: '11:00' },
    { horaInicio: '09:00' },
    { limitePorPersona: -1 },
    { consumoMinimo: -1 },
    { iniciaEn: '2100-01-01' },
  ])('rechaza configuración incoherente: %j', (datos) => {
    expect(() => configuracionBeneficio(datos, vence)).toThrow();
  });
  it('deriva los estados de vigencia y disponibilidad sin alterarlos manualmente', () => {
    const ahora = new Date('2026-11-20T15:00:00Z');
    const base = {
      activo: true,
      estado: 'publicado',
      disponibles: 2,
      iniciaEn: new Date('2026-11-01'),
      venceEn: new Date('2026-12-01'),
    };
    expect(estadoBeneficio(base, ahora)).toBe('publicado');
    expect(estadoBeneficio({ ...base, disponibles: 0 }, ahora)).toBe('agotado');
    expect(
      estadoBeneficio({ ...base, iniciaEn: new Date('2026-11-25') }, ahora),
    ).toBe('programado');
    expect(
      estadoBeneficio({ ...base, venceEn: new Date('2026-11-10') }, ahora),
    ).toBe('vencido');
    expect(
      estadoBeneficio({ ...base, activo: false, estado: 'borrador' }, ahora),
    ).toBe('borrador');
    expect(filtroEstado('publicado', ahora)).toMatchObject({
      activo: true,
      iniciaEn: { lte: ahora },
      disponibles: { gt: 0 },
    });
  });
  it('aplica los días y horarios de Perú al entregar el comprobante', () => {
    const viernes10 = new Date('2026-11-20T15:00:00Z');
    expect(() =>
      validarHorarioUso(
        { dias: [5], horaInicio: '09:00', horaFin: '11:00' },
        viernes10,
      ),
    ).not.toThrow();
    expect(() => validarHorarioUso({ dias: [1] }, viernes10)).toThrow('hoy');
    expect(() =>
      validarHorarioUso({ horaInicio: '11:00', horaFin: '12:00' }, viernes10),
    ).toThrow('horario');
    expect(() =>
      validarHorarioUso({ horaInicio: '09:00', horaFin: '10:00' }, viernes10),
    ).toThrow('horario');
  });
});
