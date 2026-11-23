import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService, type EstadoSalud } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(
    @Res({ passthrough: true }) res: Response,
  ): Promise<EstadoSalud> {
    const salud = await this.appService.verificarSalud();
    if (salud.estado !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return salud;
  }
}
