import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultCineClub();
    await this.ensureSuperAdmin();
  }

  private async ensureDefaultCineClub() {
    const count = await this.prisma.cineClub.count();
    if (count > 0) return;

    await this.prisma.cineClub.create({
      data: { name: 'Nasflix', slug: 'nasflix' },
    });
    this.logger.log('Default CineClub "Nasflix" created');
  }

  private async ensureSuperAdmin() {
    const count = await this.prisma.user.count();
    if (count > 0) return;

    const username = this.config.get<string>('ADMIN_USERNAME');
    const passwordHash = this.config.get<string>('ADMIN_PASSWORD_HASH');

    if (!username || !passwordHash) {
      this.logger.warn('ADMIN_USERNAME or ADMIN_PASSWORD_HASH not set — skipping super admin creation');
      return;
    }

    const user = await this.prisma.user.create({
      data: {
        username,
        firstName: 'Super',
        lastName: 'Admin',
        passwordHash,
        isSuperAdmin: true,
      },
    });

    // Add super admin as ADMIN of the default CineClub
    const defaultClub = await this.prisma.cineClub.findFirst({ orderBy: { createdAt: 'asc' } });
    if (defaultClub) {
      await this.prisma.cineClubMember.create({
        data: { userId: user.id, cineClubId: defaultClub.id, role: 'ADMIN' },
      });
    }

    this.logger.log(`Super admin "${username}" created and added to default CineClub`);
  }
}
