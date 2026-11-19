import { BadRequestException } from '@nestjs/common';
import {
  CategoriaDestino,
  ProvinciaDestino,
  type Prisma,
} from '../generated/prisma/client.js';

const campos = [
  ['distrito', 'Distrito', 100],
  ['etiquetas', 'Etiquetas (una por línea)', 400, 'lista'],
  ['detalles', 'Qué encontrarás', 5000, 'area'],
  ['historia', 'Historia y valor cultural o natural', 8000, 'area'],
  [
    'fuentesHistoria',
    'Fuentes de la historia (un enlace HTTPS por línea)',
    2500,
    'enlaces',
  ],
  ['telefono', 'Teléfono', 40],
  ['whatsapp', 'WhatsApp con código de país', 20, 'whatsapp'],
  ['correo', 'Correo oficial', 254, 'email'],
  ['sitioWeb', 'Sitio web', 500, 'url'],
  ['facebook', 'Facebook', 500, 'url'],
  ['instagram', 'Instagram', 500, 'url'],
  ['tiktok', 'TikTok', 500, 'url'],
  ['youtube', 'Canal de YouTube', 500, 'url'],
  ['portadaAlt', 'Texto alternativo de portada', 180],
  ['portadaAutor', 'Autor de portada', 120],
  ['portadaLicencia', 'Licencia de portada', 120],
  ['videoTitulo', 'Título del video', 160],
  ['videoYoutube', 'Video de YouTube', 500, 'url'],
  ['condicion', 'Condición de visita', 40, 'condicion'],
  ['motivoCierre', 'Motivo del cierre o restricción', 500, 'area'],
  ['reapertura', 'Reapertura estimada', 10, 'date'],
  ['ultimoIngreso', 'Último ingreso', 5, 'time'],
  ['excepcionesHorario', 'Excepciones de horario', 1000, 'area'],
  ['modalidadIngreso', 'Modalidad de ingreso', 40, 'modalidad'],
  [
    'tarifasAdicionales',
    'Otras tarifas en soles (una por línea)',
    1200,
    'lista',
  ],
  ['metodosPago', 'Métodos de pago (uno por línea)', 500, 'lista'],
  ['reservaUrl', 'Enlace oficial de reservas', 500, 'url'],
  ['accesoSilla', 'Acceso para silla de ruedas', 20, 'acceso'],
  ['rampas', 'Rampas', 20, 'acceso'],
  ['banosAdaptados', 'Baños adaptados', 20, 'acceso'],
  ['terreno', 'Condiciones del terreno', 1000, 'area'],
  ['servicios', 'Servicios e instalaciones (uno por línea)', 1200, 'lista'],
  ['idiomas', 'Idiomas de atención (uno por línea)', 500, 'lista'],
  ['reglas', 'Reglas y restricciones', 1500, 'area'],
  ['actividades', 'Actividades (una por línea)', 1200, 'lista'],
  ['duracionVisita', 'Duración sugerida de la visita', 120],
  ['dificultad', 'Dificultad del recorrido', 80],
  ['temporada', 'Temporada recomendada', 120],
  ['transporte', 'Transporte disponible', 1000, 'area'],
  ['estacionamiento', 'Información de estacionamiento', 500, 'area'],
  ['mapaUrl', 'Enlace de ubicación oficial', 500, 'url'],
  ['latitudIngreso', 'Latitud de la entrada', 25, 'latitud'],
  ['longitudIngreso', 'Longitud de la entrada', 25, 'longitud'],
  ['aviso', 'Mensaje para visitantes', 800, 'area'],
  ['avisoDesde', 'Fecha de inicio', 10, 'date'],
  ['avisoHasta', 'Fecha de fin', 10, 'date'],
] as const;
const opciones: Record<string, string[]> = {
  condicion: ['abierto', 'cerrado', 'restringido'],
  modalidad: ['libre', 'pago', 'reserva'],
  acceso: ['si', 'no'],
};

function objeto(valor: unknown, etiqueta: string) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor))
    throw new BadRequestException(`Revisa ${etiqueta}.`);
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, limite: number, etiqueta: string) {
  if (typeof valor !== 'string' || valor.trim().length > limite)
    throw new BadRequestException(
      `Revisa «${etiqueta}» (máximo ${limite} caracteres).`,
    );
  return valor.trim();
}

function validarUrl(valor: string, etiqueta: string, local = false) {
  if (!valor || (local && /^\/(?!\/)[\w./%-]+$/.test(valor))) return;
  const url = URL.canParse(valor) ? new URL(valor) : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password)
    throw new BadRequestException(
      `Ingresa un enlace HTTPS válido en «${etiqueta}».`,
    );
}

function numero(
  valor: unknown,
  minimo: number,
  maximo: number,
  etiqueta: string,
) {
  if (
    typeof valor !== 'number' ||
    !Number.isFinite(valor) ||
    valor < minimo ||
    valor > maximo
  )
    throw new BadRequestException(`Ingresa un valor válido en «${etiqueta}».`);
  return valor;
}

export function validarInformacion(entrada: unknown): Prisma.InputJsonObject {
  const datos = objeto(entrada, 'la información de visita');
  const resultado: Record<string, Prisma.InputJsonValue> = {};
  for (const [clave, etiqueta, limite, tipo] of campos) {
    const valor = texto(datos[clave] ?? '', limite, etiqueta);
    if (!valor) continue;
    if (tipo === 'url') validarUrl(valor, etiqueta);
    const redes: Record<string, string[]> = {
      facebook: ['facebook.com', 'fb.com'],
      instagram: ['instagram.com'],
      tiktok: ['tiktok.com'],
      youtube: ['youtube.com', 'youtu.be'],
    };
    if (redes[clave]) {
      const host = new URL(valor).hostname.toLowerCase();
      if (
        !redes[clave].some(
          (dominio) => host === dominio || host.endsWith(`.${dominio}`),
        )
      )
        throw new BadRequestException(`Usa un enlace oficial de ${etiqueta}.`);
    }
    if (tipo === 'enlaces')
      for (const enlace of valor.split(/\r?\n/))
        validarUrl(enlace.trim(), etiqueta);
    if (tipo === 'latitud' || tipo === 'longitud') {
      const limite = tipo === 'latitud' ? 90 : 180;
      numero(Number(valor), -limite, limite, etiqueta);
    }
    const fecha = tipo === 'date' ? new Date(valor + 'T00:00:00Z') : null;
    if (
      (fecha &&
        (!Number.isFinite(fecha.getTime()) ||
          fecha.toISOString().slice(0, 10) !== valor)) ||
      (tipo === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) ||
      (tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) ||
      (tipo === 'whatsapp' && !/^\+?[1-9]\d{6,14}$/.test(valor)) ||
      (tipo && opciones[tipo] && !opciones[tipo].includes(valor))
    )
      throw new BadRequestException(`Revisa «${etiqueta}».`);
    if (clave === 'videoYoutube') {
      const enlace = new URL(valor);
      const [, tipo, identificador] = enlace.pathname.split('/');
      const id =
        enlace.hostname === 'youtu.be'
          ? tipo
          : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(
                enlace.hostname,
              )
            ? tipo === 'shorts'
              ? identificador
              : tipo === 'watch'
                ? enlace.searchParams.get('v')
                : null
            : null;
      if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
        throw new BadRequestException(
          'Ingresa un enlace a un video de YouTube.',
        );
    }
    resultado[clave] = valor;
  }
  const { avisoDesde, avisoHasta, latitudIngreso, longitudIngreso } = resultado;
  if (
    typeof avisoDesde === 'string' &&
    typeof avisoHasta === 'string' &&
    avisoDesde > avisoHasta
  )
    throw new BadRequestException('Revisa el rango de fechas del aviso.');
  if (Boolean(latitudIngreso) !== Boolean(longitudIngreso))
    throw new BadRequestException('Completa ambas coordenadas de la entrada.');
  if ((avisoDesde || avisoHasta) && !resultado.aviso)
    throw new BadRequestException(
      'Escribe el mensaje del aviso antes de indicar sus fechas.',
    );
  if (resultado.aviso && (!avisoDesde || !avisoHasta))
    throw new BadRequestException(
      'Completa las fechas de inicio y fin del aviso temporal.',
    );
  const galeria = datos.galeria ?? [];
  if (!Array.isArray(galeria) || galeria.length > 12)
    throw new BadRequestException('La galería admite hasta 12 fotos.');
  const fotos = galeria.map((valor: unknown) => {
    const foto = objeto(valor, 'la foto de galería');
    const url = texto(foto.url, 500, 'enlace de la foto');
    if (!url) throw new BadRequestException('Ingresa el enlace de cada foto.');
    validarUrl(url, 'enlace de la foto', true);
    return {
      url,
      alt: texto(foto.alt ?? '', 180, 'texto alternativo'),
      descripcion: texto(foto.descripcion ?? '', 240, 'descripción de foto'),
      autor: texto(foto.autor ?? '', 120, 'autor'),
      licencia: texto(foto.licencia ?? '', 120, 'licencia'),
    };
  });
  if (new Set(fotos.map(({ url }) => url)).size !== fotos.length)
    throw new BadRequestException('Retira las fotos duplicadas de la galería.');
  resultado.galeria = fotos;
  return resultado;
}

export function validarCoherenciaFicha(
  informacion: Prisma.InputJsonObject,
  general: unknown,
  estudiantes: unknown,
  publicar = false,
) {
  const rechazar = (campo: string, message: string): never => {
    throw new BadRequestException({ message, campos: { [campo]: message } });
  };
  if (
    informacion.modalidadIngreso === 'libre' &&
    [general, estudiantes].some((valor) => valor != null && Number(valor) > 0)
  )
    rechazar(
      Number(general) > 0 ? 'tarifaGeneral' : 'tarifaEstudiantes',
      'La entrada libre no puede tener tarifas mayores a cero.',
    );
  if (
    publicar &&
    informacion.modalidadIngreso === 'pago' &&
    !(Number(general) > 0)
  )
    rechazar(
      'tarifaGeneral',
      'Indica una tarifa general mayor a cero para una entrada de pago.',
    );
  if (
    informacion.modalidadIngreso === 'reserva' &&
    !informacion.reservaUrl &&
    !informacion.telefono &&
    !informacion.whatsapp &&
    !informacion.correo
  )
    rechazar(
      'reservaUrl',
      'Indica un enlace o contacto oficial para gestionar las reservas.',
    );
  if (
    typeof informacion.condicion === 'string' &&
    ['cerrado', 'restringido'].includes(informacion.condicion) &&
    !informacion.motivoCierre
  )
    rechazar(
      'motivoCierre',
      'Explica el motivo del cierre o de la restricción.',
    );
  if (informacion.reapertura && informacion.condicion === 'abierto')
    rechazar(
      'reapertura',
      'Retira la fecha de reapertura si el atractivo ya está abierto.',
    );
  const hoy = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima',
  }).format(new Date());
  if (
    typeof informacion.reapertura === 'string' &&
    informacion.reapertura < hoy
  )
    rechazar(
      'reapertura',
      'Actualiza la reapertura: la fecha indicada ya pasó.',
    );
}

export function validarDatosDestino(entrada: Record<string, unknown>) {
  const categoria = entrada.categoria as CategoriaDestino;
  const provincia = entrada.provincia as ProvinciaDestino;
  if (
    !Object.values(CategoriaDestino).includes(categoria) ||
    !Object.values(ProvinciaDestino).includes(provincia)
  )
    throw new BadRequestException(
      'Selecciona una categoría y una provincia válidas.',
    );
  const nombre = texto(entrada.nombre, 120, 'nombre');
  const descripcion = texto(entrada.descripcion, 1000, 'descripción');
  const ubicacion = texto(entrada.ubicacion, 180, 'ubicación');
  if (nombre.length < 3 || descripcion.length < 20 || ubicacion.length < 4)
    throw new BadRequestException(
      'Completa el nombre, la descripción y la ubicación.',
    );
  const imagenUrl = texto(entrada.imagenUrl ?? '', 500, 'imagen principal');
  const fuenteRutaUrl = texto(
    entrada.fuenteRutaUrl ?? '',
    500,
    'fuente del trayecto',
  );
  validarUrl(imagenUrl, 'imagen principal', true);
  validarUrl(fuenteRutaUrl, 'fuente del trayecto');
  const entero = (valor: unknown, campo: string) => {
    if (valor == null) return null;
    const valorNumerico = numero(valor, 0, 100000, campo);
    if (!Number.isInteger(valorNumerico))
      throw new BadRequestException(`Ingresa un número entero en «${campo}».`);
    return valorNumerico;
  };
  return {
    nombre,
    descripcion,
    ubicacion,
    categoria,
    provincia,
    latitud: numero(entrada.latitud, -90, 90, 'latitud'),
    longitud: numero(entrada.longitud, -180, 180, 'longitud'),
    imagenUrl: imagenUrl || null,
    fuenteRutaUrl: fuenteRutaUrl || null,
    rutaDesdeChiclayo:
      texto(entrada.rutaDesdeChiclayo ?? '', 2000, 'ruta') || null,
    recomendacion:
      texto(entrada.recomendacion ?? '', 1500, 'recomendación') || null,
    distanciaKm: entero(entrada.distanciaKm, 'distancia'),
    duracionMinutos: entero(entrada.duracionMinutos, 'duración del trayecto'),
  };
}
