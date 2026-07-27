export { AuthStateRepository } from "./auth-state-repository.js";
export type { AuthStateRepositoryOptions } from "./auth-state-repository.js";
export { defaultWhatsAppSocketFactory } from "./baileys-socket.js";
export type {
  WhatsAppSocket,
  WhatsAppSocketEventEmitter,
  WhatsAppSocketEventMap,
  WhatsAppSocketFactory,
  WhatsAppSocketFactoryContext,
} from "./baileys-socket.js";
export {
  AuthStateCorruptionError,
  AuthStatePersistenceError,
  InvalidWhatsAppConnectionError,
  WhatsAppConnectionNotFoundError,
  WhatsAppConnectionUnavailableError,
  WhatsAppSendError,
  WhatsAppWebError,
} from "./errors.js";
export {
  normalizeInboundMessage,
  normalizeWhatsAppJid,
  toWhatsAppJid,
} from "./message-normalizer.js";
export { WhatsAppSocketManager } from "./socket-manager.js";
export type {
  WhatsAppConnectionSnapshot,
  WhatsAppContact,
  WhatsAppQrSnapshot,
  WhatsAppSocketManagerOptions,
} from "./socket-manager.js";
export { WhatsAppWebProvider } from "./provider.js";
export type { WhatsAppWebProviderOptions } from "./provider.js";
export { registerWhatsAppWebProvider } from "./register.js";
