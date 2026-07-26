import { ChannelProviderRegistry } from "@flowmind/channel-runtime";
import { WhatsAppWebProvider } from "./provider.js";
import type { WhatsAppWebProviderOptions } from "./provider.js";

export function registerWhatsAppWebProvider(
  registry: ChannelProviderRegistry,
  options: WhatsAppWebProviderOptions,
): WhatsAppWebProvider {
  const provider = new WhatsAppWebProvider(options);
  registry.register(provider);
  return provider;
}
