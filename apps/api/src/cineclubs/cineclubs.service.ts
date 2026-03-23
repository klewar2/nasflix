import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { MemberRole } from '@prisma/client';

@Injectable()
export class CineClubsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, isSuperAdmin: boolean) {
    if (isSuperAdmin) {
      const clubs = await this.prisma.cineClub.findMany({ orderBy: { name: 'asc' } });
      return clubs.map((c) => this.sanitize(c));
    }
    const memberships = await this.prisma.cineClubMember.findMany({
      where: { userId },
      include: { cineClub: true },
      orderBy: { cineClub: { name: 'asc' } },
    });
    return memberships.map((m) => this.sanitize(m.cineClub));
  }

  async findOne(id: number) {
    const club = await this.prisma.cineClub.findUnique({ where: { id } });
    if (!club) throw new NotFoundException('CineClub introuvable');
    return this.sanitize(club);
  }

  /** Masque les secrets sensibles — jamais exposés côté API */
  private sanitize(club: Parameters<typeof Object.assign>[0] & { webhookSecret?: string | null; freeboxAppToken?: string | null }) {
    const { webhookSecret, freeboxAppToken, ...rest } = club;
    return { ...rest, webhookSecretSet: !!webhookSecret, freeboxAppTokenSet: !!freeboxAppToken };
  }

  async create(data: { name: string; slug: string; nasBaseUrl?: string; nasSharedFolders?: string[]; tmdbApiKey?: string }) {
    const existing = await this.prisma.cineClub.findUnique({ where: { slug: data.slug } });
    if (existing) throw new ConflictException('Ce slug est déjà utilisé');
    return this.sanitize(await this.prisma.cineClub.create({ data }));
  }

  async update(id: number, data: {
    name?: string;
    nasBaseUrl?: string;
    nasSharedFolders?: string[];
    tmdbApiKey?: string;
    nasWolMac?: string | null;
    nasWolHost?: string | null;
    nasWolPort?: number | null;
    freeboxApiUrl?: string | null;
  }) {
    await this.findOne(id);
    return this.sanitize(await this.prisma.cineClub.update({ where: { id }, data }));
  }

  /** Génère un nouveau webhookSecret et le retourne en clair (une seule fois). */
  async generateWebhookSecret(id: number): Promise<{ webhookSecret: string }> {
    await this.findOne(id);

    const webhookSecret = randomBytes(32).toString('hex');
    await this.prisma.cineClub.update({ where: { id }, data: { webhookSecret } });
    return { webhookSecret };
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.cineClub.delete({ where: { id } }).then((c) => this.sanitize(c));
  }

  async getMembers(cineClubId: number) {
    return this.prisma.cineClubMember.findMany({
      where: { cineClubId },
      include: { user: { select: { id: true, username: true, firstName: true, lastName: true, lastLoginAt: true } } },
      orderBy: { user: { username: 'asc' } },
    });
  }

  async addMember(cineClubId: number, userId: number, role: MemberRole, nasUsername?: string, nasPassword?: string) {
    const existing = await this.prisma.cineClubMember.findUnique({
      where: { userId_cineClubId: { userId, cineClubId } },
    });
    if (existing) throw new ConflictException('Cet utilisateur est déjà membre');

    return this.prisma.cineClubMember.create({
      data: { userId, cineClubId, role, nasUsername, nasPassword },
    });
  }

  async updateMember(cineClubId: number, userId: number, data: { role?: MemberRole; nasUsername?: string; nasPassword?: string }) {
    return this.prisma.cineClubMember.update({
      where: { userId_cineClubId: { userId, cineClubId } },
      data,
    });
  }

  async removeMember(cineClubId: number, userId: number) {
    return this.prisma.cineClubMember.delete({
      where: { userId_cineClubId: { userId, cineClubId } },
    });
  }
}
