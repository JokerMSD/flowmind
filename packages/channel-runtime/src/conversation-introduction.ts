import type {
  ChannelConnection,
  ChannelConversation,
  ChannelConversationRepository,
  ChannelProvider,
} from "@flowmind/channel-core";

export const CSNF_INTRODUCTION =
  'Oi! Eu sou o CSNF e vou te ajudar daqui para frente. Sempre que quiser falar comigo, basta mencionar meu nome. Por exemplo: "Ei, CSNF..." ou "Tem como fazer tal coisa, CSNF?"';

export async function ensureCsnfIntroduction(input: {
  readonly connection: ChannelConnection;
  readonly conversation: ChannelConversation;
  readonly conversations: ChannelConversationRepository;
  readonly provider: ChannelProvider;
  readonly now: () => Date;
}): Promise<ChannelConversation> {
  if (typeof input.conversation.metadata.csnfIntroducedAt === "string") {
    return input.conversation;
  }
  const sent = await input.provider.send({
    connectionId: input.connection.id,
    conversationAddress: {
      channelId: input.conversation.channelId,
      externalId: input.conversation.externalConversationId,
    },
    content: CSNF_INTRODUCTION,
  });
  const introducedAt = sent.sentAt || input.now().toISOString();
  const updated: ChannelConversation = {
    ...input.conversation,
    lastOutboundAt: introducedAt,
    metadata: {
      ...input.conversation.metadata,
      csnfIntroducedAt: introducedAt,
    },
    updatedAt: input.now().toISOString(),
  };
  await input.conversations.save(updated);
  return updated;
}
