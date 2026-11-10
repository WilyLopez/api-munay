import { Module } from '@nestjs/common';
import { ServicioPrisma } from './prisma.service.js';

@Module({
  providers: [ServicioPrisma],
  exports: [ServicioPrisma],
})
export class PrismaModule {}
