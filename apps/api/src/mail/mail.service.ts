import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { CineClub, Job, JobKind } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';

interface CachedTransport {
  transporter: Transporter;
  from: string;
  cachedAt: number;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly cache = new Map<number, CachedTransport>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private getTransport(club: CineClub): CachedTransport | null {
    if (!club.gmailEnabled || !club.gmailFrom || !club.gmailAppPassword) return null;
    const cached = this.cache.get(club.id);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs && cached.from === club.gmailFrom) {
      return cached;
    }
    let password: string;
    try {
      password = this.crypto.decrypt(club.gmailAppPassword);
    } catch (err) {
      this.logger.error(`Impossible de déchiffrer le Gmail App Password pour CineClub ${club.id}: ${err}`);
      return null;
    }
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: club.gmailFrom, pass: password },
    });
    const entry = { transporter, from: club.gmailFrom, cachedAt: Date.now() };
    this.cache.set(club.id, entry);
    return entry;
  }

  private async getSuperAdminRecipients(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, email: { not: null } },
      select: { email: true },
    });
    return users.map((u) => u.email!).filter((e) => /.+@.+\..+/.test(e));
  }

  async sendJobFailedAlert(job: Job): Promise<void> {
    const club = await this.prisma.cineClub.findUnique({ where: { id: job.cineClubId } });
    if (!club) return;
    const transport = this.getTransport(club);
    if (!transport) {
      this.logger.warn(`Mail non envoyé (Gmail désactivé ou mal configuré) pour Job ${job.id}`);
      return;
    }
    const recipients = await this.getSuperAdminRecipients();
    if (recipients.length === 0) {
      this.logger.warn('Aucun super admin avec email — pas de notification mail envoyée');
      return;
    }
    const subject = `[Nasflix] Job ${this.labelKind(job.kind)} #${job.id} en échec`;
    const html = this.renderJobFailedHtml(job, club);
    try {
      await transport.transporter.sendMail({
        from: `Nasflix <${transport.from}>`,
        to: recipients.join(', '),
        subject,
        html,
      });
      this.logger.log(`Mail d'alerte envoyé pour Job ${job.id} → ${recipients.length} destinataire(s)`);
    } catch (err) {
      this.logger.error(`Erreur envoi mail Job ${job.id}: ${err}`);
    }
  }

  async sendWolFailedAlert(club: CineClub, job: Job): Promise<void> {
    const transport = this.getTransport(club);
    if (!transport) return;
    const recipients = await this.getSuperAdminRecipients();
    if (recipients.length === 0) return;
    const subject = `[Nasflix] Échec du réveil NAS — Job #${job.id} bloqué`;
    const html = `
      <h2>Le NAS ne répond pas au Wake-on-LAN</h2>
      <p>Le transfert <strong>${job.fileName ?? '(fichier inconnu)'}</strong> est en attente depuis ${club.nasWolWaitSeconds}s.</p>
      <p>Le NAS doit être démarré manuellement, puis le job pourra être relancé depuis l'interface Nasflix.</p>
      <p><strong>Job ID:</strong> ${job.id} — <strong>Source:</strong> ${job.source}</p>
      <p><strong>NAS:</strong> ${club.nasBaseUrl ?? 'non configuré'}</p>
    `;
    try {
      await transport.transporter.sendMail({
        from: `Nasflix <${transport.from}>`,
        to: recipients.join(', '),
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Erreur envoi mail WoL alert Job ${job.id}: ${err}`);
    }
  }

  private labelKind(kind: JobKind): string {
    switch (kind) {
      case 'DOWNLOAD_TO_NAS':
        return 'Transfert vers NAS';
      case 'DELETE_FROM_SEEDBOX':
        return 'Suppression seedbox';
      case 'DELETE_FROM_JELLYFIN':
        return 'Suppression Jellyfin';
    }
  }

  private renderJobFailedHtml(job: Job, club: CineClub): string {
    return `
      <h2>${this.labelKind(job.kind)} — échec</h2>
      <p><strong>Fichier:</strong> ${job.fileName ?? '—'}</p>
      <p><strong>Source path:</strong> ${job.sourcePath ?? '—'}</p>
      <p><strong>Target path:</strong> ${job.targetPath ?? '—'}</p>
      <p><strong>Erreur:</strong></p>
      <pre style="background:#1a1a1a;color:#eee;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(job.errorMessage ?? 'Erreur inconnue')}</pre>
      <hr/>
      <p><small>CineClub: ${club.name} — Job ID: ${job.id} — Tentatives: ${job.attempts}</small></p>
    `;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
