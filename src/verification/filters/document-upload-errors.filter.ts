import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Traduce los errores de multer a 400 con un mensaje claro.
 *
 * Por defecto Nest responde 413 cuando el archivo pasa el límite y
 * "Unexpected field" cuando el archivo viene en otro campo o hay más de uno;
 * el contrato de BE-07.1 pide 400 y un mensaje que el frontend pueda mostrar.
 */
@Catch(PayloadTooLargeException, BadRequestException)
export class DocumentUploadErrorsFilter implements ExceptionFilter {
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
      return 'El documento puede pesar como máximo 5 MB.';
    }
    if (/unexpected field|too many files/i.test(exception.message)) {
      return 'Enviá un solo archivo en el campo documento.';
    }
    return null;
  }
}
