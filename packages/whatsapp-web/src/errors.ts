export class WhatsAppWebError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AuthStatePersistenceError extends WhatsAppWebError {
  public constructor(
    public readonly filePath: string,
    operation: string,
    cause: unknown,
  ) {
    super(`Unable to ${operation} WhatsApp authentication state at ${filePath}`, { cause });
  }
}

export class AuthStateCorruptionError extends WhatsAppWebError {
  public constructor(
    public readonly filePath: string,
    cause?: unknown,
  ) {
    super(
      `WhatsApp authentication state is corrupt at ${filePath}; remove it or log out before pairing again`,
      { cause },
    );
  }
}

export class InvalidWhatsAppConnectionError extends WhatsAppWebError {}

export class WhatsAppConnectionNotFoundError extends WhatsAppWebError {
  public constructor(public readonly connectionId: string) {
    super(`WhatsApp connection is not active: ${connectionId}`);
  }
}

export class WhatsAppConnectionUnavailableError extends WhatsAppWebError {
  public constructor(public readonly connectionId: string) {
    super(`WhatsApp connection is not ready to send: ${connectionId}`);
  }
}

export class WhatsAppSendError extends WhatsAppWebError {}
