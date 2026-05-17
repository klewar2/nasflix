import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  private getKeys(): Buffer[] {
    const out: Buffer[] = [];
    for (const name of ['SECRETS_ENCRYPTION_KEY', 'FREEBOX_ENCRYPTION_KEY']) {
      const hex = this.config.get<string>(name);
      if (!hex) continue;
      const key = Buffer.from(hex, 'hex');
      if (key.length !== 32) {
        throw new InternalServerErrorException(`${name} invalide (doit être 32 bytes hex)`);
      }
      // dedupe
      if (!out.some((k) => k.equals(key))) out.push(key);
    }
    if (out.length === 0) {
      throw new InternalServerErrorException(
        'Aucune clé de chiffrement configurée (SECRETS_ENCRYPTION_KEY ou FREEBOX_ENCRYPTION_KEY)',
      );
    }
    return out;
  }

  /** Clé primaire utilisée pour TOUT nouveau chiffrement. */
  private getPrimaryKey(): Buffer {
    return this.getKeys()[0];
  }

  encrypt(plaintext: string): string {
    if (!plaintext) throw new BadRequestException('Plaintext vide');
    const key = this.getPrimaryKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Tente de déchiffrer avec toutes les clés connues (SECRETS puis FREEBOX legacy).
   * Permet une migration douce après rotation de clé ou changement d'env.
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new BadRequestException('Format de secret chiffré invalide');
    const [ivHex, tagHex, encHex] = parts;
    const keys = this.getKeys();
    let lastErr: Error | null = null;
    for (const key of keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new InternalServerErrorException(
      `Déchiffrement impossible avec les clés disponibles (${keys.length}). Re-saisis le secret dans Settings. Détail : ${lastErr?.message}`,
    );
  }

  encryptIfPresent(plaintext: string | null | undefined): string | null {
    if (!plaintext) return null;
    return this.encrypt(plaintext);
  }

  decryptIfPresent(ciphertext: string | null | undefined): string | null {
    if (!ciphertext) return null;
    return this.decrypt(ciphertext);
  }
}
