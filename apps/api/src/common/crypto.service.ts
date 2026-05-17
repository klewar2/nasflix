import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  private getKey(): Buffer {
    const hex =
      this.config.get<string>('SECRETS_ENCRYPTION_KEY') ??
      this.config.get<string>('FREEBOX_ENCRYPTION_KEY');
    if (!hex) {
      throw new InternalServerErrorException(
        'SECRETS_ENCRYPTION_KEY (ou FREEBOX_ENCRYPTION_KEY legacy) non configurée',
      );
    }
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
      throw new InternalServerErrorException('Clé de chiffrement invalide (doit être 32 bytes hex)');
    }
    return key;
  }

  encrypt(plaintext: string): string {
    if (!plaintext) throw new BadRequestException('Plaintext vide');
    const key = this.getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    const key = this.getKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new BadRequestException('Format de secret chiffré invalide');
    const [ivHex, tagHex, encHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
      'utf8',
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
