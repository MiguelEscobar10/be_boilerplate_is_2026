import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '@Auth/decorators';
import { BandejaService } from '@Notifications/services';
import {
  BandejaResponseDto,
  ConteoNoLeidasResponseDto,
  ListarNotificacionesQueryDto,
  NotificacionResponseDto,
} from '@Notifications/dto';
import type { User } from '@PrismaClient';

/**
 * Un id que no es UUID da 400: es un error de sintaxis de la request, como un
 * `page=abc`, y no revela nada porque ningún usuario puede tener una
 * notificación con ese id. Sin el pipe, Postgres respondería con un error de
 * tipo (22P02) y el cliente vería un 500.
 */
const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la notificación debe ser un UUID.'),
});

/**
 * Bandeja de notificaciones del usuario autenticado (H10). Cualquier rol con
 * sesión: no lleva @Roles, y el guard global de JWT exige el token.
 *
 * No tiene POST: los avisos solo se registran desde el backend con
 * AvisosService (BE-20.1).
 */
@ApiTags('notificaciones')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly bandejaService: BandejaService) {}

  // La ruta fija va antes que las que llevan :id, para que `no-leidas` nunca
  // se tome como un id si algún día se agrega un GET :id.
  @Get('no-leidas/conteo')
  @ApiOperation({ summary: 'Cuenta las notificaciones no leídas' })
  @ApiOkResponse({ type: ConteoNoLeidasResponseDto })
  contarNoLeidas(
    @CurrentUser() user: User,
  ): Promise<ConteoNoLeidasResponseDto> {
    return this.bandejaService.contarNoLeidas(user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista la bandeja del usuario, más recientes primero',
  })
  @ApiOkResponse({ type: BandejaResponseDto })
  @ApiBadRequestResponse({
    description:
      'Paginación o filtro inválidos, o un parámetro que no existe en la query.',
  })
  listar(
    @CurrentUser() user: User,
    @Query() query: ListarNotificacionesQueryDto,
  ): Promise<BandejaResponseDto> {
    return this.bandejaService.listar(user.id, query);
  }

  /** Sin body. Responde 200 (el default de Nest en PATCH) con la notificación. */
  @Patch(':id/leida')
  @ApiOperation({
    summary: 'Marca como leída una notificación propia',
    description:
      'Idempotente: si ya estaba leída, conserva la fecha de lectura original.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificacionResponseDto })
  @ApiBadRequestResponse({ description: 'El id no es un UUID.' })
  @ApiNotFoundResponse({
    description: 'La notificación no existe o pertenece a otro usuario.',
  })
  marcarLeida(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
  ): Promise<NotificacionResponseDto> {
    return this.bandejaService.marcarLeida(user.id, id);
  }
}
