import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MAX_IMAGES } from '../services/listings.service.js';

/**
 * Traduce los errores de multer a 400 con un mensaje claro.
 *
 * Por defecto Nest responde 413 cuando un archivo pasa el límite y
 * "Unexpected field" cuando sobran archivos; el contrato de BE-01.1 pide 400
 * en ambos casos y un mensaje que el frontend pueda mostrar tal cual.
 */
@Catch(PayloadTooLargeException, BadRequestException)
export class UploadErrorsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const message = this.translate(exception);

    if (message) {
      const body = new BadRequestException(message).getResponse();
      response.status(400).json(body);
      return;
    }
    response.status(exception.getStatus()).json(exception.getResponse());
  }

  private translate(exception: HttpException): string | null {
    if (exception instanceof PayloadTooLargeException) {
      return 'Cada imagen puede pesar como máximo 5 MB.';
    }
    const text = exception.message;
    if (/unexpected field|too many files/i.test(text)) {
      return `Se permiten como máximo ${MAX_IMAGES} fotografías.`;
    }
    return null;
  }
}
