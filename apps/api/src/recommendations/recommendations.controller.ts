import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { FeedbackVote, MemberRole, RecommendationType } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { RecommendationsService } from './recommendations.service';

class FeedbackDto {
  @IsEnum(FeedbackVote)
  vote: FeedbackVote;
}

class RegenerateDto {
  @IsEnum(RecommendationType)
  type: RecommendationType;
}

@Controller('recommendations')
@UseGuards(RolesGuard)
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Get()
  async list(@Req() req: { user: JwtPayload }, @Query('type') type?: string) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    if (!type || !Object.values(RecommendationType).includes(type as RecommendationType)) {
      throw new BadRequestException(`type doit être PAST ou UPCOMING`);
    }
    return this.service.listForCineclub(req.user.cineClubId, type as RecommendationType, req.user.sub);
  }

  @Get(':id')
  async getOne(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) id: number) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.service.getById(id, req.user.cineClubId, req.user.sub);
  }

  @Post('regenerate')
  @Roles(MemberRole.ADMIN)
  async regenerate(@Req() req: { user: JwtPayload }, @Body() dto: RegenerateDto) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    if (dto.type === RecommendationType.PAST) {
      return this.service.generatePast(req.user.cineClubId);
    }
    return this.service.generateUpcoming(req.user.cineClubId);
  }

  @Put(':id/feedback')
  async setFeedback(
    @Req() req: { user: JwtPayload },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackDto,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    return this.service.setFeedback(id, req.user.sub, req.user.cineClubId, dto.vote);
  }

  @Delete(':id/feedback')
  async clearFeedback(
    @Req() req: { user: JwtPayload },
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!req.user.cineClubId) throw new ForbiddenException('Aucun CineClub sélectionné');
    await this.service.clearFeedback(id, req.user.sub, req.user.cineClubId);
    return { cleared: true };
  }
}
