import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@Config';

export type ImageKind = 'jpg' | 'png';

/**
 * Guarda las fotos de las publicaciones en disco (UPLOADS_DIR).
 *
 * En la base solo queda la ruta relativa (`listings/<uuid>.jpg`), nunca la
 * ruta absoluta del servidor. Para cambiar a S3 o similar basta con cambiar
 * este servicio.
 */
@Injectable()
export class ImageStorageService {
  private readonly root: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.root = resolve(configService.get('UPLOADS_DIR', { infer: true }));
  }

  /**
   * Revisa la firma del archivo (los primeros bytes) en vez de confiar en el
   * Content-Type que manda el cliente, que se puede falsificar.
   */
  detectKind(buffer: Buffer): ImageKind | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'jpg';
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (
      buffer.length >= png.length &&
      png.every((byte, i) => buffer[i] === byte)
    ) {
      return 'png';
    }
    return null;
  }

  /** Devuelve la ruta relativa con la que se guarda en la base. */
  async save(buffer: Buffer, kind: ImageKind): Promise<string> {
    const relative = `listings/${randomUUID()}.${kind}`;
    await mkdir(join(this.root, 'listings'), { recursive: true });
    await writeFile(join(this.root, relative), buffer);
    return relative;
  }

  /** Borra archivos ya guardados; se usa si falla el insert en la base. */
  async removeMany(paths: string[]): Promise<void> {
    await Promise.all(
      paths.map((p) => rm(this.absolutePath(p), { force: true })),
    );
  }

  absolutePath(relative: string): string {
    const full = resolve(this.root, relative);
    // Nunca se sirve nada fuera de UPLOADS_DIR, aunque la ruta venga rara.
    if (!full.startsWith(this.root + sep)) {
      throw new Error(`Ruta fuera de la carpeta de archivos: ${relative}`);
    }
    return full;
  }

  contentType(relative: string): string {
    return extname(relative) === '.png' ? 'image/png' : 'image/jpeg';
  }
}
