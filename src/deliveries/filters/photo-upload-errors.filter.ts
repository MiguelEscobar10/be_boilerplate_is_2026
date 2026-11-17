import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { MAX_PHOTOS } from '../services/deliveries.service.js';

/**
 * Traduce los errores de multer a 400 con un mensaje claro: una foto de más
 * de 5 MB (Nest daría 413), más de 5 fotos o un archivo en otro campo (Nest
 * daría "Unexpected field" o, con un MulterError sin traducir, 500).
 */
@Catch(PayloadTooLargeException, BadRequestException, MulterError)
export class PhotoUploadErrorsFilter implements ExceptionFilter {
  catch(exception: HttpException | MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const message = this.translate(exception);

    if (message) {
      response.status(400).json(new BadRequestException(message).getResponse());
      return;
    }
    const http = exception as HttpException;
    response.status(http.getStatus()).json(http.getResponse());
  }

  private translate(exception: HttpException | MulterError): string | null {
    if (exception instanceof MulterError) {
      return exception.code === 'LIMIT_FILE_SIZE'
        ? 'Cada foto puede pesar como máximo 5 MB.'
        : `Se permiten como máximo ${MAX_PHOTOS} fotos, en el campo fotos.`;
    }
    if (exception instanceof PayloadTooLargeException) {
      return 'Cada foto puede pesar como máximo 5 MB.';
    }
    if (/unexpected field|too many files/i.test(exception.message)) {
      return `Se permiten como máximo ${MAX_PHOTOS} fotos, en el campo fotos.`;
    }
    return null;
  }
}
