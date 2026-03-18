import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly userSelect = {
    id: true,
    username: true,
    firstName: true,
    lastName: true,
    isSuperAdmin: true,
    lastLoginAt: true,
    createdAt: true,
  } as const;

  async findAll() {
    return this.prisma.user.findMany({
      select: this.userSelect,
      orderBy: { username: 'asc' },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: this.userSelect });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async create(data: { username: string; firstName: string; lastName: string; password: string; isSuperAdmin?: boolean }) {
    const existing = await this.prisma.user.findUnique({ where: { username: data.username } });
    if (existing) throw new ConflictException("Ce nom d'utilisateur est déjà pris");

    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        isSuperAdmin: data.isSuperAdmin ?? false,
      },
      select: this.userSelect,
    });
  }

  async update(id: number, data: { username?: string; firstName?: string; lastName?: string; password?: string; isSuperAdmin?: boolean }) {
    await this.findOne(id);

    if (data.username) {
      const conflict = await this.prisma.user.findFirst({
        where: { username: data.username, id: { not: id } },
      });
      if (conflict) throw new ConflictException("Ce nom d'utilisateur est déjà pris");
    }

    const updateData: Record<string, unknown> = {};
    if (data.username) updateData.username = data.username;
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.isSuperAdmin !== undefined) updateData.isSuperAdmin = data.isSuperAdmin;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.update({ where: { id }, data: updateData, select: this.userSelect });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.user.delete({ where: { id } });
  }
}
