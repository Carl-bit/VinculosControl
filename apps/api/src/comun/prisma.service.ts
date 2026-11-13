import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** BigInt de Prisma a number para JSON (bytes de memoria: lejos de 2^53). */
export const num = (v: bigint | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
