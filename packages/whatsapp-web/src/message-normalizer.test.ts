import assert from "node:assert/strict";
import test from "node:test";
import type { WAMessage } from "@whiskeysockets/baileys";
import { normalizeInboundMessage, normalizeWhatsAppJid, toWhatsAppJid } from "./index.js";

function message(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: {
      id: "message-1",
      remoteJid: "5511888888888@s.whatsapp.net",
      fromMe: false,
    },
    message: { conversation: "Ola" },
    messageTimestamp: 1_721_996_400,
    ...overrides,
  };
}

test("normalizes private text JIDs, identity, timestamp and fromMe", () => {
  const normalized = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      key: { id: "message-1", remoteJid: "5511888888888:4@s.whatsapp.net", fromMe: true },
    }),
  );

  assert.equal(normalized?.connectionId, "whatsapp-personal");
  assert.equal(normalized?.providerMessageId, "message-1");
  assert.deepEqual(normalized?.conversationAddress, {
    channelId: "whatsapp",
    externalId: "5511888888888",
  });
  assert.equal(normalized?.conversationType, "private");
  assert.equal(normalized?.senderAddress.externalId, "5511888888888");
  assert.equal(normalized?.content, "Ola");
  assert.equal(normalized?.occurredAt, "2024-07-26T12:20:00.000Z");
  assert.equal(normalized?.fromSelf, true);
  assert.equal(normalized?.unsupported, false);
});

test("normalizes group sender and extended text", () => {
  const normalized = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      key: {
        id: "group-message",
        remoteJid: "120363000000000000@g.us",
        participant: "5511777777777:2@s.whatsapp.net",
        fromMe: false,
      },
      message: { extendedTextMessage: { text: "Mensagem do grupo" } },
    }),
  );

  assert.equal(normalized?.conversationType, "group");
  assert.equal(normalized?.conversationAddress.externalId, "120363000000000000@g.us");
  assert.equal(normalized?.senderAddress.externalId, "5511777777777");
  assert.equal(normalized?.content, "Mensagem do grupo");
  assert.equal(normalized?.unsupported, false);
});

test("unwraps ephemeral text and marks media and unknown events unsupported", () => {
  const ephemeral = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      message: {
        ephemeralMessage: {
          message: { extendedTextMessage: { text: "Temporaria" } },
        },
      },
    }),
  );
  const media = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      key: { id: "media", remoteJid: "5511888888888@s.whatsapp.net" },
      message: { imageMessage: { caption: "Legenda" } },
    }),
  );
  const unknown = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      key: { id: "unknown", remoteJid: "5511888888888@s.whatsapp.net" },
      message: { reactionMessage: { text: "reaction" } },
    }),
  );
  const broadcast = normalizeInboundMessage(
    "whatsapp-personal",
    message({
      key: { id: "status", remoteJid: "status@broadcast" },
      message: { conversation: "Status" },
    }),
  );

  assert.equal(ephemeral?.content, "Temporaria");
  assert.equal(ephemeral?.unsupported, false);
  assert.equal(media?.content, "Legenda");
  assert.equal(media?.unsupported, true);
  assert.equal(unknown?.content, "");
  assert.equal(unknown?.unsupported, true);
  assert.equal(broadcast?.unsupported, true);
});

test("rejects incomplete events and converts outbound private addresses to JIDs", () => {
  assert.equal(
    normalizeInboundMessage(
      "whatsapp-personal",
      message({ key: { remoteJid: "5511888888888@s.whatsapp.net" } }),
    ),
    undefined,
  );
  assert.equal(normalizeWhatsAppJid("5511888888888:9@s.whatsapp.net"), "5511888888888");
  assert.equal(normalizeWhatsAppJid("123456789@lid"), "123456789@lid");
  assert.equal(toWhatsAppJid("5511888888888"), "5511888888888@s.whatsapp.net");
  assert.equal(toWhatsAppJid("120363000000000000@g.us"), "120363000000000000@g.us");
  assert.throws(() => toWhatsAppJid("invalid-address"), /Invalid WhatsApp/);
});
