export class ChannelCoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownChannelProviderError extends ChannelCoreError {
  public constructor(public readonly providerId: string) {
    super(`Channel provider is not registered: ${providerId}`);
  }
}

export class DuplicateChannelProviderError extends ChannelCoreError {
  public constructor(public readonly providerId: string) {
    super(`Channel provider is already registered: ${providerId}`);
  }
}

export class InvalidQueueOptionsError extends ChannelCoreError {}
