import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ServicioPrisma } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockPrisma = {
      cliente: {
        $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      },
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ServicioPrisma,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('debe responder con el nombre de la API', () => {
      expect(appController.getHello()).toBe('Munay API');
    });
  });

  describe('health', () => {
    it('debe retornar estado de salud ok', async () => {
      const mockRes = { status: vi.fn() } as unknown as import('express').Response;
      const salud = await appController.getHealth(mockRes);
      expect(salud.estado).toBe('ok');
      expect(salud.baseDatos.conectada).toBe(true);
    });
  });
});
