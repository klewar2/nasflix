import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { CineClubsService } from './cineclubs.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { MemberRole } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { AddMemberDto, CreateCineClubDto, UpdateCineClubDto, UpdateMemberDto } from './dto/cineclub.dto';

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
  create(@Body() dto: CreateCineClubDto) {
    return this.cineClubsService.create(dto);
  }

  @Patch(':id')
  @Roles(MemberRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCineClubDto) {
    return this.cineClubsService.update(id, dto);
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
    @Body() dto: AddMemberDto,
  ) {
    return this.cineClubsService.addMember(cineClubId, dto.userId, dto.role, dto.nasUsername, dto.nasPassword);
  }

  @Patch(':id/members/:userId')
  @Roles(MemberRole.ADMIN)
  updateMember(
    @Param('id', ParseIntPipe) cineClubId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.cineClubsService.updateMember(cineClubId, userId, dto);
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
