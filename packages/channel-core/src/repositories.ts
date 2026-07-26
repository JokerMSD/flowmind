import type { ChannelConnection } from "./connection.js";
import type { ChannelConversation } from "./conversation.js";
import type { ExternalMessageRecord } from "./external-message.js";
import type { ChannelMessage } from "./message.js";
import type { ChannelSettings } from "./settings.js";

export interface ChannelConnectionRepository {
  findById(id: string): Promise<ChannelConnection | undefined>;
  list(): Promise<readonly ChannelConnection[]>;
  save(connection: ChannelConnection): Promise<void>;
}

export interface ChannelConversationRepository {
  findById(id: string): Promise<ChannelConversation | undefined>;
  findByConnectionAndExternalConversationId(
    connectionId: string,
    externalConversationId: string,
  ): Promise<ChannelConversation | undefined>;
  save(conversation: ChannelConversation): Promise<void>;
}

export interface ChannelMessageRepository {
  findById(id: string): Promise<ChannelMessage | undefined>;
  listByConversation(conversationId: string): Promise<readonly ChannelMessage[]>;
  save(message: ChannelMessage): Promise<void>;
}

export interface ExternalMessageRecordRepository {
  find(connectionId: string, providerMessageId: string): Promise<ExternalMessageRecord | undefined>;
  claim(record: ExternalMessageRecord): Promise<boolean>;
  save(record: ExternalMessageRecord): Promise<void>;
}

export interface ChannelSettingsRepository {
  get(): Promise<ChannelSettings>;
  save(settings: ChannelSettings): Promise<void>;
}
