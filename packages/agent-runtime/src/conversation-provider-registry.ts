import { ProviderNotRegisteredError } from "@flowmind/agent-core";
import type { ConversationProvider } from "./conversation.js";

export class ConversationProviderRegistry {
  private readonly providers = new Map<string, ConversationProvider>();

  public register(provider: ConversationProvider): void {
    this.providers.set(provider.id, provider);
  }

  public resolve(providerId: string): ConversationProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new ProviderNotRegisteredError(providerId);
    return provider;
  }
}
