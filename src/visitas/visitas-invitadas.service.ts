import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import { validarGeocerca, RADIO_VISITA_METROS } from './geocerca.js';
import {
  bloquearDestino,
  comprobarVigencia,
  VisitasService,
} from './visitas.service.js';

function huellaToken(token: unknown) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    throw new BadRequestException(
      'La verificación temporal no es válida. Escanea nuevamente el QR.',
    );
  return createHash('sha256').update(token).digest('hex');
}

async function bloquearInvitada(tx: Prisma.TransactionClient, hash: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))::text`;
}

const incluirCodigo = {
  codigo: {
    select: {
      destino: {
        select: {
          id: true,
          nombre: true,
          slug: true,
          imagenUrl: true,
          estadoEditorial: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class VisitasInvitadasService {
  constructor(
    private readonly prisma: ServicioPrisma,
    private readonly visitas: VisitasService,
  ) {}

  async preparar(token: unknown, texto: unknown, slug?: string) {
    const hash = huellaToken(token);
    const codigo = await this.visitas.obtenerCodigoVisita(texto, slug);
    return this.prisma.cliente.$transaction(async (tx) => {
      await bloquearInvitada(tx, hash);
      await bloquearDestino(tx, codigo.destino.id);
      const actual = await tx.visitaInvitada.findUnique({
        where: { tokenHash: hash },
        include: incluirCodigo,
      });
      if (actual?.usuarioId)
        throw new GoneException('Esta visita ya está asociada a una cuenta.');
      if (
        actual &&
        actual.venceEn > new Date() &&
        actual.codigo.destino.id === codigo.destino.id
      ) {
        if (actual.verificadaEn)
          return {
            estado: 'verificada',
            datos: {
              visita: { id: actual.id, verificadaEn: actual.verificadaEn },
              destino: codigo.destino,
              yaVerificada: false,
            },
          } as const;
        if (actual.codigoId === codigo.id)
          return {
            estado: 'ubicacion',
            destino: codigo.destino,
            radioMetros: RADIO_VISITA_METROS,
          } as const;
      }
      const vigente = await tx.codigoVisita.findUnique({
        where: { id: codigo.id },
      });
      if (!vigente) throw new GoneException('El QR ya no está disponible.');
      comprobarVigencia(vigente, new Date());
      const datos = {
        codigoId: codigo.id,
        venceEn: new Date(Date.now() + 300000),
        verificadaEn: null,
      };
      await tx.visitaInvitada.upsert({
        where: { tokenHash: hash },
        create: { tokenHash: hash, ...datos },
        update: datos,
      });
      return {
        estado: 'ubicacion',
        destino: codigo.destino,
        radioMetros: RADIO_VISITA_METROS,
      } as const;
    });
  }

  async verificar(
    token: unknown,
    texto: unknown,
    slug: string | undefined,
    ubicacion: unknown,
  ) {
    const hash = huellaToken(token);
    const codigo = await this.visitas.obtenerCodigoVisita(texto, slug);
    return this.prisma.cliente.$transaction(async (tx) => {
      await bloquearInvitada(tx, hash);
      await bloquearDestino(tx, codigo.destino.id);
      const actual = await tx.visitaInvitada.findUnique({
        where: { tokenHash: hash },
      });
      if (
        !actual ||
        actual.usuarioId ||
        actual.codigoId !== codigo.id ||
        actual.venceEn <= new Date()
      )
        throw new GoneException(
          'Tu verificación temporal venció. Escanea el QR vigente para continuar.',
        );
      const geocerca = validarGeocerca(codigo.destino, ubicacion);
      const guardada = actual.verificadaEn
        ? actual
        : await tx.visitaInvitada.update({
            where: { id: actual.id },
            data: {
              verificadaEn: new Date(),
              venceEn: new Date(Date.now() + 86400000),
            },
          });
      return {
        visita: { id: guardada.id, verificadaEn: guardada.verificadaEn },
        destino: codigo.destino,
        geocerca,
        yaVerificada: false,
      };
    });
  }

  async estado(token: unknown, slug: unknown) {
    const actual = await this.prisma.cliente.visitaInvitada.findUnique({
      where: { tokenHash: huellaToken(token) },
      include: incluirCodigo,
    });
    if (
      !actual?.verificadaEn ||
      actual.usuarioId ||
      actual.venceEn <= new Date() ||
      actual.codigo.destino.slug !== slug ||
      actual.codigo.destino.estadoEditorial !== 'publicada'
    )
      throw new GoneException(
        'La verificación de esta visita ya no está disponible. Escanea el QR del lugar.',
      );
    const { id, nombre, slug: slugDestino, imagenUrl } = actual.codigo.destino;
    const destino = { id, nombre, slug: slugDestino, imagenUrl };
    return {
      destino,
      fechaVisita: actual.verificadaEn,
      estado: 'habilitada',
      resenaId: null,
      puntosResena: 10,
      puntosSelfie: 5,
    };
  }

  async reclamar(token: unknown, perfil: { id: string; rol: string }) {
    if (perfil.rol !== 'TURISTA')
      throw new ForbiddenException(
        'Continúa con una cuenta de visitante para guardar esta visita.',
      );
    const hash = huellaToken(token);
    return this.prisma.cliente.$transaction(async (tx) => {
      await bloquearInvitada(tx, hash);
      const actual = await tx.visitaInvitada.findUnique({
        where: { tokenHash: hash },
        include: incluirCodigo,
      });
      if (
        !actual?.verificadaEn ||
        actual.venceEn <= new Date() ||
        actual.codigo.destino.estadoEditorial !== 'publicada'
      )
        throw new GoneException(
          'La verificación temporal venció. Escanea nuevamente el QR.',
        );
      if (actual.usuarioId && actual.usuarioId !== perfil.id)
        throw new ForbiddenException(
          'Esta verificación ya está asociada a otra cuenta.',
        );
      await bloquearDestino(tx, actual.codigo.destino.id);
      const disponible = await tx.destino.count({
        where: { id: actual.codigo.destino.id, estadoEditorial: 'publicada' },
      });
      if (!disponible)
        throw new GoneException(
          'Este lugar ya no está disponible para registrar visitas.',
        );
      const visita = await tx.visitaVerificada.upsert({
        where: {
          usuarioId_destinoId: {
            usuarioId: perfil.id,
            destinoId: actual.codigo.destino.id,
          },
        },
        create: {
          usuarioId: perfil.id,
          destinoId: actual.codigo.destino.id,
          codigoId: actual.codigoId,
          verificadaEn: actual.verificadaEn,
        },
        update: {},
        select: { id: true },
      });
      await tx.visitaInvitada.update({
        where: { id: actual.id },
        data: { usuarioId: perfil.id },
      });
      return { visitaId: visita.id, slug: actual.codigo.destino.slug };
    });
  }
}
