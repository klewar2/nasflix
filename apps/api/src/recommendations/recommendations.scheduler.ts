import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { RecommendationsService } from './recommendations.service';

@Injectable()
export class RecommendationsScheduler {
  private readonly logger = new Logger(RecommendationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: RecommendationsService,
  ) {}

  /** Lundi 08:00 — génère les recos PAST et UPCOMING pour chaque cineclub activé. */
  @Cron('0 8 * * 1', { timeZone: 'Europe/Paris' })
  async runWeekly() {
    const clubs = await this.prisma.cineClub.findMany({
      where: { recommendationsEnabled: true, anthropicApiKey: { not: null } },
      select: { id: true, name: true },
    });
    this.logger.log(`[scheduler] ${clubs.length} cineclubs éligibles aux recos hebdo`);

    for (const club of clubs) {
      try {
        await this.service.generatePast(club.id);
      } catch (err) {
        this.logger.error(`[scheduler] generatePast cineClub#${club.id} (${club.name}) : ${err}`);
      }
      try {
        await this.service.generateUpcoming(club.id);
      } catch (err) {
        this.logger.error(`[scheduler] generateUpcoming cineClub#${club.id} (${club.name}) : ${err}`);
      }
    }
  }
}
