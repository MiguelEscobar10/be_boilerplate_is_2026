import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@Config';

export type DocumentKind = 'jpg' | 'png' | 'pdf';

/** Carpeta, dentro de UPLOADS_DIR, donde se guardan los documentos de identidad. */
const FOLDER = 'verificaciones';

/**
 * Guarda los documentos de identidad (H07) en disco, dentro de UPLOADS_DIR.
 *
 * Igual que las fotos de publicaciones, en la base solo queda la ruta relativa
 * (`verificaciones/<uuid>.pdf`). La diferencia es que estos archivos son
 * privados: ninguna ruta pública los sirve; solo el REVISOR los abre por la
 * ruta protegida de BE-07.2.
 */
@Injectable()
export class DocumentStorageService {
  private readonly root: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.root = resolve(configService.get('UPLOADS_DIR', { infer: true }));
  }

  /**
   * Revisa la firma del archivo (los primeros bytes) en vez de confiar en el
   * Content-Type o la extensión que manda el cliente, que se pueden falsificar.
   */
  detectKind(buffer: Buffer): DocumentKind | null {
    const startsWith = (signature: number[]) =>
      buffer.length >= signature.length &&
      signature.every((byte, i) => buffer[i] === byte);

    if (startsWith([0xff, 0xd8, 0xff])) return 'jpg';
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return 'png';
    }
    // %PDF-
    if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
    return null;
  }

  /** Devuelve la ruta relativa con la que se guarda en la base. */
  async save(buffer: Buffer, kind: DocumentKind): Promise<string> {
    const relative = `${FOLDER}/${randomUUID()}.${kind}`;
    await mkdir(join(this.root, FOLDER), { recursive: true });
    await writeFile(join(this.root, relative), buffer);
    return relative;
  }

  /** Borra un documento ya guardado; se usa si falla el insert en la base. */
  async remove(relative: string): Promise<void> {
    await rm(this.absolutePath(relative), { force: true });
  }

  contentType(relative: string): string {
    if (relative.endsWith('.pdf')) return 'application/pdf';
    if (relative.endsWith('.png')) return 'image/png';
    return 'image/jpeg';
  }

  absolutePath(relative: string): string {
    const full = resolve(this.root, relative);
    // Nunca se lee ni se borra nada fuera de UPLOADS_DIR, aunque la ruta venga rara.
    if (!full.startsWith(this.root + sep)) {
      throw new Error(`Ruta fuera de la carpeta de archivos: ${relative}`);
    }
    return full;
  }
}
