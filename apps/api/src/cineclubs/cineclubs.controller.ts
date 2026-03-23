import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { CineClubsService } from './cineclubs.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { MemberRole } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@Controller('cineclubs')
@UseGuards(RolesGuard)
export class CineClubsController {
  constructor(private readonly cineClubsService: CineClubsService) {}

  @Get()
  findAll(@Req() req: { user: JwtPayload }) {
    return this.cineClubsService.findAll(req.user.sub, req.user.isSuperAdmin);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.cineClubsService.findOne(id);
  }

  @Post()
  @Roles(MemberRole.ADMIN)
  create(@Body() body: { name: string; slug: string; nasBaseUrl?: string; nasSharedFolders?: string[]; tmdbApiKey?: string }) {
    return this.cineClubsService.create(body);
  }

  @Patch(':id')
  @Roles(MemberRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      name?: string;
      nasBaseUrl?: string;
      nasSharedFolders?: string[];
      tmdbApiKey?: string;
      nasWolMac?: string | null;
      nasWolHost?: string | null;
      nasWolPort?: number | null;
      freeboxApiUrl?: string | null;
    },
  ) {
    return this.cineClubsService.update(id, body);
  }

  @Post(':id/generate-webhook-secret')
  @Roles(MemberRole.ADMIN)
  generateWebhookSecret(@Param('id', ParseIntPipe) id: number) {
    return this.cineClubsService.generateWebhookSecret(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.cineClubsService.remove(id);
  }

  @Get(':id/members')
  getMembers(@Param('id', ParseIntPipe) id: number) {
    return this.cineClubsService.getMembers(id);
  }

  @Post(':id/members')
  @Roles(MemberRole.ADMIN)
  addMember(
    @Param('id', ParseIntPipe) cineClubId: number,
    @Body() body: { userId: number; role: MemberRole; nasUsername?: string; nasPassword?: string },
  ) {
    return this.cineClubsService.addMember(cineClubId, body.userId, body.role, body.nasUsername, body.nasPassword);
  }

  @Patch(':id/members/:userId')
  @Roles(MemberRole.ADMIN)
  updateMember(
    @Param('id', ParseIntPipe) cineClubId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: { role?: MemberRole; nasUsername?: string; nasPassword?: string },
  ) {
    return this.cineClubsService.updateMember(cineClubId, userId, body);
  }

  @Delete(':id/members/:userId')
  @Roles(MemberRole.ADMIN)
  removeMember(
    @Param('id', ParseIntPipe) cineClubId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.cineClubsService.removeMember(cineClubId, userId);
  }
}
