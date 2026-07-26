export class WhatsAppApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "WhatsAppApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message = "Payload do WhatsApp invalido."): WhatsAppApiError {
  return new WhatsAppApiError(400, "INVALID_WHATSAPP_REQUEST", message);
}

export function notFound(message: string): WhatsAppApiError {
  return new WhatsAppApiError(404, "WHATSAPP_RESOURCE_NOT_FOUND", message);
}

export function conflict(message: string): WhatsAppApiError {
  return new WhatsAppApiError(409, "WHATSAPP_OPERATION_NOT_ALLOWED", message);
}

export function unavailable(message = "Integracao WhatsApp indisponivel."): WhatsAppApiError {
  return new WhatsAppApiError(503, "WHATSAPP_UNAVAILABLE", message);
}
