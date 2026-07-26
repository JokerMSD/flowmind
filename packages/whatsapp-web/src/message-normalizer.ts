import { jidNormalizedUser, normalizeMessageContent, toNumber } from "@whiskeysockets/baileys";
import type { InboundMessage } from "@flowmind/channel-core";
import type { WAMessage } from "@whiskeysockets/baileys";

const USER_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";
const GROUP_SUFFIX = "@g.us";

export function normalizeWhatsAppJid(jid: string): string {
  const normalized = jidNormalizedUser(jid.trim());
  if (normalized.endsWith(USER_SUFFIX)) return normalized.slice(0, -USER_SUFFIX.length);
  return normalized;
}

export function toWhatsAppJid(externalId: string): string {
  const normalized = externalId.trim();
  if (normalized.length === 0) throw new Error("WhatsApp address cannot be empty");
  if (normalized.includes("@")) return jidNormalizedUser(normalized);
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid WhatsApp private address: ${externalId}`);
  }
  return `${normalized}${USER_SUFFIX}`;
}

function unwrapMessage(message: WAMessage["message"]): WAMessage["message"] {
  return normalizeMessageContent(message);
}

function textContent(message: WAMessage["message"]): {
  readonly content: string;
  readonly unsupported: boolean;
} {
  const content = unwrapMessage(message);
  if (!content) return { content: "", unsupported: true };
  if (typeof content.conversation === "string") {
    return { content: content.conversation, unsupported: false };
  }
  const extended = content.extendedTextMessage?.text;
  if (typeof extended === "string") {
    return { content: extended, unsupported: false };
  }

  const caption =
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    "";
  return { content: caption, unsupported: true };
}

function occurredAt(message: WAMessage): string {
  const timestamp = message.messageTimestamp;
  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : timestamp === null || timestamp === undefined
        ? 0
        : toNumber(timestamp);
  return new Date(seconds > 0 ? seconds * 1_000 : Date.now()).toISOString();
}

export function normalizeInboundMessage(
  connectionId: string,
  message: WAMessage,
): InboundMessage | undefined {
  const remoteJid = message.key.remoteJid;
  const providerMessageId = message.key.id;
  if (!remoteJid || !providerMessageId) return undefined;

  const group = remoteJid.endsWith(GROUP_SUFFIX);
  const chatJid = group || remoteJid.endsWith(USER_SUFFIX) || remoteJid.endsWith(LID_SUFFIX);
  const participant = message.key.participant ?? remoteJid;
  const text = textContent(message.message);

  return {
    connectionId,
    providerMessageId,
    conversationAddress: {
      channelId: "whatsapp",
      externalId: normalizeWhatsAppJid(remoteJid),
    },
    conversationType: group ? "group" : "private",
    senderAddress: {
      channelId: "whatsapp",
      externalId: normalizeWhatsAppJid(participant),
    },
    content: text.content,
    occurredAt: occurredAt(message),
    fromSelf: message.key.fromMe === true,
    unsupported: text.unsupported || !chatJid,
    raw: message,
  };
}
