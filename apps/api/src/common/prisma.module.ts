import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BootstrapService } from './bootstrap.service';

@Global()
@Module({
  providers: [PrismaService, BootstrapService],
  exports: [PrismaService],
})
export class PrismaModule {}
