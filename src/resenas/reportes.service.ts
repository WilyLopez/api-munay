import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  alcanceAdministrador,
  type PerfilConRol,
} from '../autenticacion/alcance-administrador.js';
import { ServicioPrisma } from '../prisma/prisma.service.js';
import { revertirPuntos } from '../puntos/puntos.service.js';
import { actualizarPromedioResenas } from './promedio-resenas.js';

const TAMANO_PAGINA = 20;

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: ServicioPrisma) {}

  async reportar(id: string, perfil: PerfilConRol, motivo: unknown) {
    const alcance = alcanceAdministrador(perfil);
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (texto.length < 10 || texto.length > 500) {
      throw new BadRequestException(
        'Describe el motivo con entre 10 y 500 caracteres.',
      );
    }
    const total = await this.prisma.cliente.$executeRaw`
      INSERT INTO munay.reportes_resenas (id, resena_id, reportada_por, motivo)
      SELECT gen_random_uuid(), r.id, ${perfil.id}::uuid, ${texto}
      FROM munay.resenas r
      WHERE r.id = ${id}::uuid AND r.retirada_en IS NULL AND (
        ${perfil.rol === 'SUPER_ADMIN'} OR EXISTS (
          SELECT 1 FROM munay.administradores_destinos a
          WHERE a.destino_id = r.destino_id AND a.usuario_id = ${perfil.id}::uuid
        )
      ) FOR SHARE OF r
      ON CONFLICT (resena_id, reportada_por) DO NOTHING`;
    if (total) return;
    const resena = await this.prisma.cliente.resena.findFirst({
      where: { id, destino: alcance, retiradaEn: null },
      select: { id: true },
    });
    if (!resena)
      throw new NotFoundException(
        'La reseña no está disponible para tu cuenta.',
      );
    throw new ConflictException('Ya enviaste un reporte sobre esta reseña.');
  }

  async listar(perfil: PerfilConRol, revisados: boolean, pagina: number) {
    this.verificarSuperAdmin(perfil);
    const filas = await this.prisma.cliente.reporteResena.findMany({
      where: { revisadoEn: revisados ? { not: null } : null },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * TAMANO_PAGINA,
      take: TAMANO_PAGINA + 1,
      select: {
        id: true,
        motivo: true,
        creadoEn: true,
        revisadoEn: true,
        decision: true,
        motivoDecision: true,
        resena: {
          select: {
            id: true,
            comentario: true,
            calificacion: true,
            destino: { select: { nombre: true, slug: true } },
            usuario: { select: { nombreCompleto: true } },
          },
        },
      },
    });
    return {
      reportes: filas.slice(0, TAMANO_PAGINA),
      hayMas: filas.length > TAMANO_PAGINA,
    };
  }

  async revisar(
    id: string,
    perfil: PerfilConRol,
    decision: unknown,
    motivo: unknown,
  ) {
    this.verificarSuperAdmin(perfil);
    if (decision !== 'mantener' && decision !== 'retirar') {
      throw new BadRequestException(
        'Elige si deseas mantener o retirar la reseña.',
      );
    }
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (decision === 'retirar' && (texto.length < 10 || texto.length > 500)) {
      throw new BadRequestException(
        'Escribe un motivo de retiro de 10 a 500 caracteres.',
      );
    }
    await this.prisma.cliente.$transaction(
      async (tx) => {
        const reporte = await tx.reporteResena.findUnique({
          where: { id },
          select: { resenaId: true, resena: { select: { destinoId: true } } },
        });
        if (!reporte)
          throw new NotFoundException('El reporte ya no está disponible.');
        const {
          resenaId,
          resena: { destinoId },
        } = reporte;
        await tx.$queryRaw`SELECT id FROM munay.destinos WHERE id = ${destinoId}::uuid FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT id FROM munay.resenas WHERE id = ${resenaId}::uuid FOR NO KEY UPDATE`;
        const ahora = new Date();
        const datos = {
          decision,
          revisadoEn: ahora,
          revisadoPor: perfil.id,
          motivoDecision: decision === 'retirar' ? texto : null,
        };
        const cambio = await tx.reporteResena.updateMany({
          where: { id, revisadoEn: null },
          data: datos,
        });
        if (!cambio.count) {
          const actual = await tx.reporteResena.findUnique({
            where: { id },
            select: { decision: true },
          });
          if (!actual)
            throw new NotFoundException('El reporte ya no está disponible.');
          if (actual.decision === decision) return;
          throw new ConflictException(
            'Este reporte ya tiene una decisión registrada.',
          );
        }
        if (decision === 'retirar') {
          await tx.resena.update({
            where: { id: resenaId },
            data: { retiradaEn: ahora, puntosPendientes: false },
          });
          await revertirPuntos(tx, resenaId);
          await tx.reporteResena.updateMany({
            where: { resenaId, revisadoEn: null },
            data: datos,
          });
          await actualizarPromedioResenas(tx, destinoId);
        }
      },
      { maxWait: 8000, timeout: 15000 },
    );
  }

  private verificarSuperAdmin(perfil: PerfilConRol) {
    if (perfil.rol !== 'SUPER_ADMIN') throw new ForbiddenException();
  }
}
