import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export function configuracionBeneficio(
  datos: Record<string, unknown>,
  venceEn: Date,
) {
  const tipo = datos.tipo ?? 'EXPERIENCIA';
  if (
    typeof tipo !== 'string' ||
    !['PORCENTAJE', 'IMPORTE', 'ENTRADA', 'EXPERIENCIA'].includes(tipo)
  )
    throw new BadRequestException('Selecciona un tipo de beneficio válido.');
  const valor = ['PORCENTAJE', 'IMPORTE'].includes(tipo) ? datos.valor : null;
  if (
    valor !== null &&
    (typeof valor !== 'number' ||
      !Number.isInteger(valor) ||
      valor < 1 ||
      valor > (tipo === 'PORCENTAJE' ? 100 : 100000000))
  )
    throw new BadRequestException(
      'Revisa el valor del descuento. El porcentaje debe estar entre 1 y 100; el importe se expresa en céntimos.',
    );
  if (['PORCENTAJE', 'IMPORTE'].includes(tipo) && valor == null)
    throw new BadRequestException('Indica el valor del descuento.');
  const iniciaEn =
    datos.iniciaEn === undefined
      ? new Date()
      : new Date(typeof datos.iniciaEn === 'string' ? datos.iniciaEn : '');
  if (!Number.isFinite(iniciaEn.getTime()) || iniciaEn >= venceEn)
    throw new BadRequestException(
      'La fecha de inicio debe ser anterior al vencimiento.',
    );
  const limite =
    datos.limitePorPersona === undefined
      ? datos.unUso === false
        ? null
        : 1
      : datos.limitePorPersona;
  if (
    limite !== null &&
    (typeof limite !== 'number' ||
      !Number.isInteger(limite) ||
      limite < 1 ||
      limite > 100)
  )
    throw new BadRequestException(
      'El límite por visitante debe estar entre 1 y 100 o quedar sin límite.',
    );
  const dias = datos.dias ?? [];
  if (
    !Array.isArray(dias) ||
    dias.length > 7 ||
    dias.some((dia) => !Number.isInteger(dia) || dia < 0 || dia > 6) ||
    new Set(dias).size !== dias.length
  )
    throw new BadRequestException('Selecciona días de uso válidos.');
  const horaInicio = datos.horaInicio || null;
  const horaFin = datos.horaFin || null;
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (
    Boolean(horaInicio) !== Boolean(horaFin) ||
    (horaInicio &&
      (typeof horaInicio !== 'string' ||
        typeof horaFin !== 'string' ||
        !hora.test(horaInicio) ||
        !hora.test(horaFin) ||
        horaInicio >= horaFin))
  )
    throw new BadRequestException(
      'Configura el inicio y fin del horario en el mismo día.',
    );
  const consumoMinimo = datos.consumoMinimo ?? 0;
  if (
    typeof consumoMinimo !== 'number' ||
    !Number.isInteger(consumoMinimo) ||
    consumoMinimo < 0 ||
    consumoMinimo > 100000000
  )
    throw new BadRequestException('El consumo mínimo no es válido.');
  const exclusiones =
    typeof datos.exclusiones === 'string' ? datos.exclusiones.trim() : '';
  if (exclusiones.length > 1000)
    throw new BadRequestException(
      'Las exclusiones admiten hasta 1000 caracteres.',
    );
  return {
    tipo,
    valor: valor as number | null,
    iniciaEn,
    limitePorPersona: limite as number | null,
    unUso: limite === 1,
    dias: dias as number[],
    horaInicio: horaInicio as string | null,
    horaFin: horaFin as string | null,
    consumoMinimo,
    exclusiones,
    reservaPrevia: datos.reservaPrevia === true,
    acumulable: datos.acumulable === true,
  };
}

export function estadoBeneficio(
  datos: {
    estado?: string;
    activo: boolean;
    venceEn: Date;
    iniciaEn?: Date;
    disponibles: number;
  },
  ahora = new Date(),
) {
  if (datos.venceEn <= ahora) return 'vencido';
  if (!datos.activo) return datos.estado ?? 'pendiente';
  if (datos.disponibles <= 0) return 'agotado';
  if (datos.iniciaEn && datos.iniciaEn > ahora) return 'programado';
  return 'publicado';
}

export function filtroEstado(
  estado?: string,
  ahora = new Date(),
): Prisma.BeneficioWhereInput {
  if (estado === 'vencido') return { venceEn: { lte: ahora } };
  if (['borrador', 'pendiente', 'pausado'].includes(estado ?? ''))
    return { estado, venceEn: { gt: ahora } };
  if (estado === 'agotado')
    return { activo: true, disponibles: 0, venceEn: { gt: ahora } };
  if (estado === 'programado')
    return {
      activo: true,
      disponibles: { gt: 0 },
      iniciaEn: { gt: ahora },
      venceEn: { gt: ahora },
    };
  if (estado === 'publicado')
    return {
      activo: true,
      disponibles: { gt: 0 },
      iniciaEn: { lte: ahora },
      venceEn: { gt: ahora },
    };
  return {};
}

export function validarHorarioUso(
  detalle: Prisma.JsonValue,
  ahora = new Date(),
) {
  if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) return;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      weekday: 'short',
    }).format(ahora),
  );
  if (
    Array.isArray(detalle.dias) &&
    detalle.dias.length &&
    !detalle.dias.includes(dia)
  )
    throw new BadRequestException(
      'El beneficio no se puede utilizar hoy. Revisa los días de uso del comprobante.',
    );
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ahora);
  if (
    typeof detalle.horaInicio === 'string' &&
    typeof detalle.horaFin === 'string' &&
    (hora < detalle.horaInicio || hora >= detalle.horaFin)
  )
    throw new BadRequestException(
      'El beneficio está fuera de su horario de uso. No se ha consumido el comprobante.',
    );
}
