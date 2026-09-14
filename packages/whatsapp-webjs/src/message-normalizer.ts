import { WHATSAPP_CHANNEL_ID } from "@flowmind/channel-core";
import type { NormalizedWebJsMessage, WebJsMessage } from "./types.js";

export async function normalizeWebJsMessage(
  connectionId: string,
  message: WebJsMessage,
  historical = false,
): Promise<NormalizedWebJsMessage | undefined> {
  const externalConversationId = message.fromMe ? message.to : message.from;
  if (!externalConversationId || !isUserConversationId(externalConversationId)) {
    return undefined;
  }
  const isGroup = externalConversationId.endsWith("@g.us");
  const senderId = message.author ?? (message.fromMe ? message.to : message.from);
  if (!senderId) return undefined;

  const [contact, chat] = await Promise.all([
    safe(() => message.getContact()),
    safe(() => message.getChat()),
  ]);
  const displayName =
    contact?.name ??
    contact?.pushname ??
    contact?.shortName ??
    chat?.name ??
    phone(externalConversationId);
  const mediaInfo = message.hasMedia ? mediaInfoFrom(message.type) : undefined;
  const content = message.body.trim();

  return {
    inbound: {
      connectionId,
      providerMessageId: message.id._serialized,
      conversationAddress: {
        channelId: WHATSAPP_CHANNEL_ID,
        externalId: externalConversationId,
      },
      senderAddress: {
        channelId: WHATSAPP_CHANNEL_ID,
        externalId: senderId,
      },
      conversationType: isGroup ? "group" : "private",
      content,
      fromSelf: message.fromMe,
      occurredAt: new Date(message.timestamp * 1_000).toISOString(),
      ...(displayName ? { displayName } : {}),
      unsupported: mediaInfo !== undefined && content.length === 0,
      ...(historical ? { historical: true } : {}),
    },
    ...(mediaInfo === undefined ? {} : { mediaInfo }),
  };
}

function mediaInfoFrom(type: string): NormalizedWebJsMessage["mediaInfo"] {
  const kind =
    type === "ptt"
      ? "audio"
      : type === "image" ||
          type === "video" ||
          type === "audio" ||
          type === "document" ||
          type === "sticker"
        ? type
        : undefined;
  return kind ? { kind, mimeType: "application/octet-stream" } : undefined;
}

function phone(id: string): string {
  return id.replace(/@.+$/, "");
}

function isUserConversationId(id: string): boolean {
  return (
    id !== "status@broadcast" &&
    !id.endsWith("@broadcast") &&
    !id.endsWith("@newsletter") &&
    (id.endsWith("@c.us") ||
      id.endsWith("@g.us") ||
      id.endsWith("@lid") ||
      id.endsWith("@s.whatsapp.net"))
  );
}

async function safe<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch {
    return undefined;
  }
}
