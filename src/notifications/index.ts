export * from './notifications.module.js';

// API pública del servicio de avisos (contrato en
// docs/contratos/servicio-avisos.md). Los demás módulos importan todo desde
// `@Notifications`. Los exports van por nombre a propósito: lo interno del
// módulo (repositorio, errores del repositorio, servicio de la bandeja) no se
// publica.
export { AvisosService } from './services/avisos.service.js';
export { AvisoInvalidoError } from './errors/aviso-invalido.error.js';
export { ModuloOrigen } from './types/aviso.types.js';
export type {
  Aviso,
  AvisoRegistrado,
  CampoAviso,
  ReferenciaAviso,
} from './types/aviso.types.js';
