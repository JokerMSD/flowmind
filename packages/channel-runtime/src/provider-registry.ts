import { DuplicateChannelProviderError, UnknownChannelProviderError } from "@flowmind/channel-core";
import type {
  ChannelProvider,
  ChannelProviderRegistry as ChannelProviderRegistryContract,
} from "@flowmind/channel-core";

export class ChannelProviderRegistry<
  TProvider extends ChannelProvider = ChannelProvider,
> implements ChannelProviderRegistryContract<TProvider> {
  private readonly providers = new Map<string, TProvider>();

  public register(provider: TProvider): void {
    if (this.providers.has(provider.id)) {
      throw new DuplicateChannelProviderError(provider.id);
    }
    this.providers.set(provider.id, provider);
  }

  public get(providerId: string): TProvider | undefined {
    return this.providers.get(providerId);
  }

  public resolve(providerId: string): TProvider {
    const provider = this.get(providerId);
    if (!provider) throw new UnknownChannelProviderError(providerId);
    return provider;
  }

  public list(): readonly TProvider[] {
    return [...this.providers.values()];
  }
}
