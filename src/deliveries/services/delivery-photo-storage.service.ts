import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@Config';

export type PhotoKind = 'jpg' | 'png';

const FOLDER = 'entregas';

/**
 * Guarda las fotos del estado inicial (H08) en `UPLOADS_DIR/entregas`. En la
 * base queda solo la ruta relativa. Mismo criterio que las fotos de
 * publicaciones (BE-01.1): el tipo se decide por la firma del archivo.
 */
@Injectable()
export class DeliveryPhotoStorageService {
  private readonly root: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.root = resolve(configService.get('UPLOADS_DIR', { infer: true }));
  }

  detectKind(buffer: Buffer): PhotoKind | null {
    const startsWith = (signature: number[]) =>
      buffer.length >= signature.length &&
      signature.every((byte, i) => buffer[i] === byte);
    if (startsWith([0xff, 0xd8, 0xff])) return 'jpg';
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return 'png';
    }
    return null;
  }

  async save(buffer: Buffer, kind: PhotoKind): Promise<string> {
    const relative = `${FOLDER}/${randomUUID()}.${kind}`;
    await mkdir(join(this.root, FOLDER), { recursive: true });
    await writeFile(join(this.root, relative), buffer);
    return relative;
  }

  /** Borra fotos ya guardadas; se usa si la transacción falla. */
  async removeMany(paths: string[]): Promise<void> {
    await Promise.all(
      paths.map((p) => rm(this.absolutePath(p), { force: true })),
    );
  }

  absolutePath(relative: string): string {
    const full = resolve(this.root, relative);
    if (!full.startsWith(this.root + sep)) {
      throw new Error(`Ruta fuera de la carpeta de archivos: ${relative}`);
    }
    return full;
  }

  contentType(relative: string): string {
    return extname(relative) === '.png' ? 'image/png' : 'image/jpeg';
  }
}
