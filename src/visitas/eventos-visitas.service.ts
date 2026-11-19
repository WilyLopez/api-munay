import {
  Injectable,
  Logger,
  type MessageEvent,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Client } from 'pg';
import {
  BehaviorSubject,
  Subject,
  debounceTime,
  filter,
  interval,
  map,
  merge,
  takeUntil,
  timer,
} from 'rxjs';
import { configuracionPostgres } from '../prisma/configuracion-postgres.js';

const CANAL = 'munay_visitas';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

@Injectable()
export class EventosVisitasService implements OnModuleInit, OnModuleDestroy {
  private readonly registro = new Logger(EventosVisitasService.name);
  private readonly cambios = new Subject<string>();
  private readonly finalizar = new Subject<void>();
  private readonly conectado = new BehaviorSubject(false);
  private cliente?: Client;
  private reintento?: ReturnType<typeof setTimeout>;
  private cerrado = false;

  onModuleInit() {
    void this.conectar();
  }

  private async conectar() {
    if (this.cerrado || this.cliente) return;
    const cadena = process.env.DIRECT_URL;
    if (!cadena) return;
    let cliente: Client | undefined;
    try {
      if (new URL(cadena).port === '6543')
        throw new Error('Se requiere conexión de sesión.');
      cliente = new Client({
        ...configuracionPostgres(cadena),
        keepAlive: true,
        application_name: 'munay-visitas-eventos',
      });
      this.cliente = cliente;
      cliente.on('notification', (mensaje) => {
        if (
          mensaje.channel === CANAL &&
          mensaje.payload &&
          UUID.test(mensaje.payload)
        )
          this.cambios.next(mensaje.payload);
      });
      cliente.on('error', () => this.desconectar(cliente!));
      cliente.on('end', () => this.desconectar(cliente!));
      await cliente.connect();
      await cliente.query(`LISTEN ${CANAL}`);
      if (this.cerrado || this.cliente !== cliente) {
        await cliente.end().catch(() => {});
        return;
      }
      this.conectado.next(true);
    } catch {
      if (cliente) this.desconectar(cliente);
      else this.programarReintento();
      this.registro.warn(
        'Canal de visitas no disponible; el panel conserva su sincronización periódica.',
      );
    }
  }

  private desconectar(cliente: Client) {
    if (this.cliente !== cliente) return;
    this.cliente = undefined;
    this.conectado.next(false);
    void cliente.end().catch(() => {});
    this.programarReintento();
  }

  private programarReintento() {
    if (this.cerrado || this.reintento) return;
    this.reintento = setTimeout(() => {
      this.reintento = undefined;
      void this.conectar();
    }, 10000);
    this.reintento.unref();
  }

  observar(destinoId: string) {
    return merge(
      this.conectado.pipe(
        map(
          (conectado) =>
            ({ type: 'estado', data: { conectado } }) satisfies MessageEvent,
        ),
      ),
      this.cambios.pipe(
        filter((id) => id === destinoId),
        debounceTime(75),
        map(
          () =>
            ({
              type: 'actualizacion',
              data: { actualizar: true },
            }) satisfies MessageEvent,
        ),
      ),
      interval(15000).pipe(
        map(() => ({ type: 'latido', data: {} }) satisfies MessageEvent),
      ),
    ).pipe(takeUntil(merge(timer(45000), this.finalizar)));
  }

  async onModuleDestroy() {
    this.cerrado = true;
    this.finalizar.next();
    this.finalizar.complete();
    if (this.reintento) clearTimeout(this.reintento);
    this.conectado.next(false);
    const cliente = this.cliente;
    this.cliente = undefined;
    await cliente?.end().catch(() => {});
    this.cambios.complete();
    this.conectado.complete();
  }
}
