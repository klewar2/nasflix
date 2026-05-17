import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BootstrapService } from './bootstrap.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [PrismaService, BootstrapService, CryptoService],
  exports: [PrismaService, CryptoService],
})
export class PrismaModule {}
