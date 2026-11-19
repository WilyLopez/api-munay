import { readFileSync } from 'node:fs';

export function configuracionPostgres(cadena: string) {
  const url = new URL(cadena);
  const certificado = readFileSync(
    new URL('../../prisma/certs/supabase-ca.crt', import.meta.url),
    'utf8',
  );
  for (const parametro of [
    'ssl',
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
  ])
    url.searchParams.delete(parametro);
  return {
    connectionString: url.toString(),
    ssl: { ca: certificado, rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
  };
}
