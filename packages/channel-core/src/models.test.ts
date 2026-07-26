import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_CONNECTION_STATUSES,
  EXTERNAL_MESSAGE_STATUSES,
  createDefaultChannelSettings,
  createWhatsAppPersonalConnectionSeed,
  defaultAutomationModeForConversation,
  externalMessageKey,
  WHATSAPP_CHANNEL_ID,
} from "./index.js";
import type {
  ChannelAddress,
  ChannelConversation,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from "./index.js";

const BASE_TIME = "2026-07-26T12:00:00.000Z";

test("Alpha 0.3 uses whatsapp as the channel and a disabled whatsapp-personal connection seed", () => {
  const connection = createWhatsAppPersonalConnectionSeed(BASE_TIME);

  assert.equal(WHATSAPP_CHANNEL_ID, "whatsapp");
  assert.deepEqual(connection, {
    id: "whatsapp-personal",
    channelId: "whatsapp",
    providerId: "whatsapp-web",
    name: "WhatsApp pessoal",
    enabled: false,
    status: "disconnected",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  });
});

test("connection statuses are exactly the Alpha 0.3 lifecycle", () => {
  assert.deepEqual(CHANNEL_CONNECTION_STATUSES, [
    "disconnected",
    "connecting",
    "waiting_for_qr",
    "authenticated",
    "connected",
    "reconnecting",
    "logged_out",
    "error",
  ]);
});

test("addresses, messages and send results carry channel and connection identities", () => {
  const address: ChannelAddress = {
    channelId: "whatsapp",
    externalId: "5511888888888",
  };
  const inbound: InboundMessage = {
    connectionId: "whatsapp-personal",
    providerMessageId: "provider-1",
    conversationAddress: address,
    conversationType: "private",
    senderAddress: address,
    content: "Ola",
    occurredAt: BASE_TIME,
    fromSelf: false,
    unsupported: false,
  };
  const outbound: OutboundMessage = {
    connectionId: inbound.connectionId,
    conversationAddress: address,
    content: "Resposta",
    replyToProviderMessageId: inbound.providerMessageId,
  };
  const result: SendResult = {
    connectionId: outbound.connectionId,
    providerMessageId: "provider-2",
    sentAt: BASE_TIME,
  };

  assert.equal(address.channelId, "whatsapp");
  assert.equal(address.externalId, "5511888888888");
  assert.equal(inbound.connectionId, outbound.connectionId);
  assert.equal(outbound.connectionId, result.connectionId);
});

test("conversation model includes external identity, type, automation and metadata", () => {
  const conversation: ChannelConversation = {
    id: "conversation-1",
    channelId: "whatsapp",
    connectionId: "whatsapp-personal",
    externalConversationId: "5511888888888",
    type: "private",
    agentId: "csnf",
    automationMode: "disabled",
    unreadCount: 0,
    metadata: { displayName: "Cliente" },
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };

  assert.equal(conversation.externalConversationId, "5511888888888");
  assert.equal(conversation.type, "private");
  assert.equal(conversation.automationMode, "disabled");
  assert.deepEqual(conversation.metadata, { displayName: "Cliente" });
  assert.equal(defaultAutomationModeForConversation("private"), "disabled");
  assert.equal(defaultAutomationModeForConversation("group"), "blocked");
});

test("channel settings are disabled and split auto/global rate limits by default", () => {
  const settings = createDefaultChannelSettings("csnf");

  assert.equal(settings.enabled, false);
  assert.equal(settings.pauseAll, false);
  assert.equal(settings.defaultConversationMode, "disabled");
  assert.equal(settings.allowGroups, false);
  assert.equal(settings.processMessagesFromSelf, false);
  assert.notEqual(settings.rateLimit.auto, settings.rateLimit.global);
});

test("external message identity includes connection and provider message", () => {
  assert.deepEqual(EXTERNAL_MESSAGE_STATUSES, [
    "received",
    "processing",
    "processed",
    "failed",
    "ignored",
  ]);
  assert.notEqual(
    externalMessageKey({ connectionId: "one", providerMessageId: "same" }),
    externalMessageKey({ connectionId: "two", providerMessageId: "same" }),
  );
});
