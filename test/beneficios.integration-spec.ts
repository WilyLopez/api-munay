import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { BeneficiosService } from '../src/beneficios/beneficios.service.js';
import type { ServicioPrisma } from '../src/prisma/prisma.service.js';

// Never reads DATABASE_URL. This suite only accepts an explicit loopback instance.
const cadena = process.env.BENEFICIOS_TEST_POSTGRES;
if (!cadena)
  throw new Error(
    'Falta BENEFICIOS_TEST_POSTGRES: usa una instancia PostgreSQL local aislada.',
  );
const url = new URL(cadena);
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/postgres'
)
  throw new Error(
    'Solo se permite PostgreSQL local y la base de control postgres.',
  );
const nombre = `munay_test_${randomUUID().replaceAll('-', '')}`;
const control = new Pool({ connectionString: cadena, ssl: false });
let db: PrismaClient;
let servicio: BeneficiosService;
let creada = false;
const superadmin = { id: randomUUID(), rol: 'SUPER_ADMIN' } as const;
const admin = { id: randomUUID(), rol: 'ADMIN_DESTINO' } as const;
const otroAdmin = { id: randomUUID(), rol: 'ADMIN_DESTINO' } as const;
const turistas = [0, 1].map(() => ({
  id: randomUUID(),
  rol: 'TURISTA' as const,
}));
let destinoId: string;
const venceEn = new Date(Date.now() + 86400000 * 30).toISOString();
async function propuesta(cupos = 1, costo = 30) {
  const datos = {
    destinoId,
    nombre: 'Beneficio de integración',
    local: 'Local ficticio de pruebas',
    categoria: 'EXPERIENCIAS',
    condiciones: 'Solo escenario automatizado, sin promoción real.',
    horario: 'Según condiciones del comprobante',
    costo,
    disponibles: cupos,
    venceEn,
    iniciaEn: new Date(Date.now() - 60000).toISOString(),
    limitePorPersona: null,
    unUso: false,
  };
  const { id } = await servicio.guardar(admin, datos);
  const pendiente = await db.beneficio.findUniqueOrThrow({ where: { id } });
  expect(pendiente.activo).toBe(false);
  await servicio.guardar(
    superadmin,
    {
      ...datos,
      activo: true,
      revision: pendiente.revision,
      stockActual: pendiente.disponibles,
    },
    id,
  );
  return db.beneficio.findUniqueOrThrow({ where: { id } });
}
async function saldo(id: string) {
  return (
    (
      await db.movimientoPuntos.aggregate({
        where: { usuarioId: id },
        _sum: { puntos: true },
      })
    )._sum.puntos ?? 0
  );
}
async function credito(id: string, puntos: number) {
  const resena = await db.resena.create({
    data: {
      usuarioId: id,
      destinoId,
      calificacion: 5,
      comentario: 'Opinión ficticia para saldo de prueba.',
    },
  });
  await db.movimientoPuntos.create({
    data: { usuarioId: id, resenaId: resena.id, tipo: 'acreditacion', puntos },
  });
}
beforeAll(async () => {
  await control.query(`CREATE DATABASE "${nombre}"`);
  creada = true;
  const local = new URL(cadena!);
  local.pathname = `/${nombre}`;
  const pool = new Pool({ connectionString: local.toString(), ssl: false });
  try {
    // Minimal Supabase DDL dependencies; storage/auth behavior is not exercised here.
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid,name text,bucket_id text);
      CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS 'SELECT string_to_array($1,''/'')';`);
    const raiz = new URL('../prisma/migrations/', import.meta.url);
    for (const carpeta of (await readdir(raiz, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      await pool.query(
        await readFile(new URL(`${carpeta.name}/migration.sql`, raiz), 'utf8'),
      );
    }
  } finally {
    await pool.end();
  }
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: local.toString(),
      ssl: false,
      max: 10,
    }),
  });
  servicio = new BeneficiosService({
    cliente: db,
  } as unknown as ServicioPrisma);
  for (const perfil of [superadmin, admin, otroAdmin, ...turistas])
    await db.usuario.create({
      data: { ...perfil, nombreCompleto: 'Cuenta ficticia de integración' },
    });
  const destino = await db.destino.create({
    data: {
      slug: `prueba-${randomUUID()}`,
      nombre: 'Atractivo ficticio',
      descripcion: 'Datos locales de integración',
      ubicacion: 'Laboratorio',
      categoria: 'CULTURA',
      provincia: 'CHICLAYO',
      latitud: -6.77,
      longitud: -79.84,
    },
  });
  destinoId = destino.id;
  await db.administradorDestino.create({
    data: { usuarioId: admin.id, destinoId },
  });
}, 60000);
afterAll(async () => {
  await db?.$disconnect();
  if (creada) await control.query(`DROP DATABASE "${nombre}" WITH (FORCE)`);
  await control.end();
}, 15000);

describe('Beneficios con PostgreSQL real y bloqueos concurrentes', () => {
  it('propone, aprueba, canjea, recupera el comprobante y registra una sola entrega', async () => {
    const oferta = await propuesta();
    const turista = turistas[0];
    await credito(turista.id, 100);
    const antes = await saldo(turista.id);
    const solicitud = randomUUID();
    const canje = await servicio.canjear(turista, oferta.id, solicitud, {
      costo: oferta.costo,
      version: oferta.revision,
    });
    const repetido = await servicio.canjear(turista, oferta.id, solicitud, {
      costo: oferta.costo,
      version: oferta.revision,
    });
    expect(repetido.codigo).toBe(canje.codigo);
    expect(await saldo(turista.id)).toBe(antes - 30);
    expect(
      (await servicio.misCanjes(turista, 1)).canjes.some(
        (c) => c.id === solicitud,
      ),
    ).toBe(true);
    await expect(servicio.usar(otroAdmin, canje.codigo, true)).rejects.toThrow(
      'atractivo',
    );
    expect(
      (await servicio.usar(admin, canje.codigo, false)).puedeEntregar,
    ).toBe(true);
    const entregas = await Promise.allSettled([
      servicio.usar(admin, canje.codigo, true),
      servicio.usar(superadmin, canje.codigo, true),
    ]);
    expect(entregas.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.auditoriaBeneficio.count({
        where: { canjeId: solicitud, accion: 'entregar' },
      }),
    ).toBe(1);
    expect(
      await db.movimientoPuntos.count({ where: { canjeId: solicitud } }),
    ).toBe(1);
  });
  it('dos visitantes compiten por el último cupo sin inventario negativo ni descuentos al perdedor', async () => {
    const oferta = await propuesta();
    await credito(turistas[1].id, 100);
    const antes = await Promise.all(turistas.map((t) => saldo(t.id)));
    const respuestas = await Promise.allSettled(
      turistas.map((t) =>
        servicio.canjear(t, oferta.id, randomUUID(), {
          costo: oferta.costo,
          version: oferta.revision,
        }),
      ),
    );
    expect(respuestas.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await db.beneficio.findUniqueOrThrow({ where: { id: oferta.id } }))
        .disponibles,
    ).toBe(0);
    for (let i = 0; i < turistas.length; i++)
      expect(await saldo(turistas[i].id)).toBe(
        antes[i] - (respuestas[i].status === 'fulfilled' ? 30 : 0),
      );
  });
  it('la misma cuenta no gasta su saldo simultáneamente en dos beneficios', async () => {
    const turista = { id: randomUUID(), rol: 'TURISTA' } as const;
    await db.usuario.create({
      data: { ...turista, nombreCompleto: 'Saldo limitado' },
    });
    await credito(turista.id, 30);
    const ofertas = await Promise.all([propuesta(), propuesta()]);
    const resultados = await Promise.allSettled(
      ofertas.map((o) =>
        servicio.canjear(turista, o.id, randomUUID(), {
          costo: o.costo,
          version: o.revision,
        }),
      ),
    );
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await saldo(turista.id)).toBe(0);
    expect(
      await db.canjeBeneficio.count({ where: { usuarioId: turista.id } }),
    ).toBe(1);
  });
  it('dos reintentos simultáneos de una solicitud devuelven el mismo comprobante', async () => {
    const oferta = await propuesta(2, 10);
    const solicitud = randomUUID();
    const respuestas = await Promise.all(
      [0, 1].map(() =>
        servicio.canjear(turistas[1], oferta.id, solicitud, {
          costo: 10,
          version: oferta.revision,
        }),
      ),
    );
    expect(respuestas[0].codigo).toBe(respuestas[1].codigo);
    expect(
      await db.movimientoPuntos.count({ where: { canjeId: solicitud } }),
    ).toBe(1);
    expect(
      (await db.beneficio.findUniqueOrThrow({ where: { id: oferta.id } }))
        .disponibles,
    ).toBe(1);
  });
});

it('un fallo después de reservar revierte comprobante, cupo y descuento en la misma transacción', async () => {
  const oferta = await propuesta();
  const turista = turistas[0];
  const antes = await saldo(turista.id);
  const solicitud = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION munay.fallo_canje_prueba() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.canje_id = '${solicitud}'::uuid THEN RAISE EXCEPTION 'Fallo deliberado de integración'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fallo_canje_prueba BEFORE INSERT ON munay.movimientos_puntos FOR EACH ROW EXECUTE FUNCTION munay.fallo_canje_prueba()',
  );
  try {
    await expect(
      servicio.canjear(turista, oferta.id, solicitud, {
        costo: oferta.costo,
        version: oferta.revision,
      }),
    ).rejects.toThrow();
    expect(
      await db.canjeBeneficio.findUnique({ where: { id: solicitud } }),
    ).toBeNull();
    expect(
      (await db.beneficio.findUniqueOrThrow({ where: { id: oferta.id } }))
        .disponibles,
    ).toBe(1);
    expect(await saldo(turista.id)).toBe(antes);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fallo_canje_prueba ON munay.movimientos_puntos',
    );
    await db.$executeRawUnsafe('DROP FUNCTION munay.fallo_canje_prueba()');
  }
});

it('un cambio de costo invalida la confirmación anterior sin gastar saldo', async () => {
  const oferta = await propuesta();
  const antes = await saldo(turistas[0].id);
  await db.beneficio.update({
    where: { id: oferta.id },
    data: { costo: 40, revision: { increment: 1 } },
  });
  await expect(
    servicio.canjear(turistas[0], oferta.id, randomUUID(), {
      costo: oferta.costo,
      version: oferta.revision,
    }),
  ).rejects.toThrow('cambió');
  expect(await saldo(turistas[0].id)).toBe(antes);
  expect(
    await db.canjeBeneficio.count({ where: { beneficioId: oferta.id } }),
  ).toBe(0);
});

it('un comprobante vencido no se entrega y conserva el historial de canje', async () => {
  const oferta = await propuesta(1, 10);
  const canje = await servicio.canjear(turistas[1], oferta.id, randomUUID(), {
    costo: 10,
    version: oferta.revision,
  });
  await db.canjeBeneficio.update({
    where: { id: canje.id },
    data: { venceEn: new Date('2000-01-01') },
  });
  await expect(servicio.usar(admin, canje.codigo, true)).rejects.toThrow(
    'venció',
  );
  expect(
    (await db.canjeBeneficio.findUniqueOrThrow({ where: { id: canje.id } }))
      .usadoEn,
  ).toBeNull();
  expect(
    await db.auditoriaBeneficio.count({
      where: { canjeId: canje.id, accion: 'entregar' },
    }),
  ).toBe(0);
});
