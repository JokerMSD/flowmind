import type {
  ChannelConnection,
  ChannelConversation,
  ChannelMessage,
  ChannelSettings,
} from "@flowmind/channel-core";
import { WHATSAPP_CHANNEL_ID } from "@flowmind/channel-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createAdminAuthHook, type AdminAuth } from "../admin/index.js";
import { WhatsAppApiError, notFound, unavailable } from "./errors.js";
import type { WhatsAppContainer } from "./container.js";
import {
  modeMatches,
  parseConnectionBody,
  parseConnectionId,
  parseConversationId,
  parseConversationMode,
  parseConversationQuery,
  parseManualMessage,
  parseSettingsUpdate,
  toUiMode,
} from "./validation.js";

export const WHATSAPP_ROUTE_PREFIXES = [
  "/integrations/whatsapp",
  "/api/integrations/whatsapp",
  "/api/admin/whatsapp",
] as const;

export function registerWhatsAppRoutes(
  server: FastifyInstance,
  container: WhatsAppContainer,
  auth: AdminAuth,
): void {
  for (const prefix of WHATSAPP_ROUTE_PREFIXES) {
    registerPrefix(server, prefix, container, auth);
  }
}

function registerPrefix(
  server: FastifyInstance,
  prefix: string,
  container: WhatsAppContainer,
  auth: AdminAuth,
): void {
  const protectedRoute = { onRequest: createAdminAuthHook(auth) };

  for (const path of [`${prefix}/status`, `${prefix}/qr`] as const) {
    server.get(path, protectedRoute, async (request, reply) =>
      respond(reply, async () => {
        const query = asRecord(request.query);
        const connectionId = parseConnectionId(query.connectionId);
        return path.endsWith("/qr")
          ? qrPayload(container, connectionId)
          : statusPayload(container, connectionId);
      }),
    );
  }

  for (const suffix of ["status", "qr"] as const) {
    for (const path of [
      `${prefix}/:connectionId/${suffix}`,
      `${prefix}/connections/:connectionId/${suffix}`,
    ]) {
      server.get(path, protectedRoute, async (request, reply) =>
        respond(reply, async () => {
          const connectionId = pathParameter(request, "connectionId");
          return suffix === "qr"
            ? qrPayload(container, connectionId)
            : statusPayload(container, connectionId);
        }),
      );
    }
  }

  for (const operation of ["connect", "reconnect", "logout"] as const) {
    server.post(`${prefix}/${operation}`, protectedRoute, async (request, reply) =>
      respond(reply, async () => {
        const connection = await container.manager[operation](parseConnectionBody(request.body));
        return statusPayload(container, connection.id);
      }),
    );
    for (const path of [
      `${prefix}/:connectionId/${operation}`,
      `${prefix}/connections/:connectionId/${operation}`,
    ]) {
      server.post(path, protectedRoute, async (request, reply) =>
        respond(reply, async () => {
          const connection = await container.manager[operation](
            pathParameter(request, "connectionId"),
          );
          return statusPayload(container, connection.id);
        }),
      );
    }
  }

  server.get(`${prefix}/settings`, protectedRoute, async (_request, reply) =>
    respond(reply, async () => settingsPayload(await container.memory.settings.get())),
  );
  server.patch(`${prefix}/settings`, protectedRoute, async (request, reply) =>
    respond(reply, async () => {
      const current = await container.memory.settings.get();
      const update = parseSettingsUpdate(request.body, current);
      return settingsPayload(await container.updateSettings(update));
    }),
  );

  server.post(`${prefix}/pause`, protectedRoute, async (_request, reply) =>
    respond(reply, async () => settingsPayload(await container.updateSettings({ pauseAll: true }))),
  );
  server.post(`${prefix}/resume`, protectedRoute, async (_request, reply) =>
    respond(reply, async () =>
      settingsPayload(await container.updateSettings({ pauseAll: false })),
    ),
  );

  server.get(`${prefix}/conversations`, protectedRoute, async (request, reply) =>
    respond(reply, async () => {
      const query = parseConversationQuery(request.query);
      await container.syncProviderChats(query.connectionId);
      const conversations = await container.memory.conversations.list({
        connectionId: query.connectionId,
        ...(query.search === undefined ? {} : { search: query.search }),
        order: "desc",
      });
      const chats = container.provider.listChats?.(query.connectionId) ?? [];
      const activeChatIds = new Set(chats.map((chat) => chat.externalId));
      const canonicalConversations = new Map<string, ChannelConversation>();
      for (const conversation of conversations) {
        const externalId = conversation.normalizedPhone ?? conversation.externalConversationId;
        if (!activeChatIds.has(externalId)) continue;
        const current = canonicalConversations.get(externalId);
        if (
          current === undefined ||
          (current.externalConversationId.endsWith("@lid") &&
            !conversation.externalConversationId.endsWith("@lid"))
        ) {
          canonicalConversations.set(externalId, conversation);
        }
      }
      const filtered = [...canonicalConversations.values()].filter((conversation) =>
        modeMatches(conversation.automationMode, query.mode),
      );
      const chatOrder = new Map(chats.map((chat, index) => [chat.externalId, index]));
      const chatByExternalId = new Map(chats.map((chat) => [chat.externalId, chat]));
      return [...filtered]
        .sort((left, right) => {
          const leftOrder =
            chatOrder.get(left.normalizedPhone ?? left.externalConversationId) ??
            Number.MAX_SAFE_INTEGER;
          const rightOrder =
            chatOrder.get(right.normalizedPhone ?? right.externalConversationId) ??
            Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return conversationActivity(right).localeCompare(conversationActivity(left));
        })
        .map((conversation) => {
          const payload = conversationPayload(conversation);
          const chat = chatByExternalId.get(
            conversation.normalizedPhone ?? conversation.externalConversationId,
          );
          if (!chat) return payload;
          return {
            ...payload,
            updatedAt: chat.lastActivityAt,
            unread: chat.unreadCount,
            pinned: chat.pinnedAt !== undefined,
          };
        });
    }),
  );

  server.get(`${prefix}/contacts`, protectedRoute, async (request, reply) =>
    respond(reply, async () => {
      const query = asRecord(request.query);
      const connectionId = parseConnectionId(query.connectionId);
      await requireConnection(container, connectionId);
      const contacts = container.provider.listContacts?.(connectionId) ?? [];
      const conversations = await container.memory.conversations.list({
        connectionId,
        order: "desc",
      });
      const privateConversations = conversations.filter(
        (conversation) => conversation.type === "private",
      );
      const conversationByPhone = new Map<string, ChannelConversation>();
      for (const conversation of privateConversations) {
        const phone = conversation.normalizedPhone ?? conversation.externalConversationId;
        const current = conversationByPhone.get(phone);
        if (
          current === undefined ||
          (current.externalConversationId.endsWith("@lid") &&
            !conversation.externalConversationId.endsWith("@lid"))
        ) {
          conversationByPhone.set(phone, conversation);
        }
      }
      const merged = new Map(
        contacts.map((contact) => {
          const conversation = conversationByPhone.get(contact.phone ?? contact.id);
          return [
            contact.id,
            {
              ...contact,
              ...(conversation === undefined ? {} : { conversationId: conversation.id }),
            },
          ];
        }),
      );
      for (const conversation of privateConversations) {
        const phone = conversation.normalizedPhone ?? conversation.externalConversationId;
        if (merged.has(phone)) continue;
        const avatarUrl =
          typeof conversation.metadata.avatarUrl === "string"
            ? conversation.metadata.avatarUrl
            : undefined;
        merged.set(phone, {
          id: phone,
          name: conversation.displayName ?? phone,
          phone,
          conversationId: conversation.id,
          ...(avatarUrl === undefined ? {} : { avatarUrl }),
        });
      }
      return [...merged.values()]
        .filter((contact) => isUsableContact(contact.phone ?? contact.id))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    }),
  );

  server.get(`${prefix}/conversations/:conversationId`, protectedRoute, async (request, reply) =>
    respond(reply, async () => conversationPayload(await requireConversation(container, request))),
  );

  for (const suffix of ["mode", "automation-mode"] as const) {
    server.patch(
      `${prefix}/conversations/:conversationId/${suffix}`,
      protectedRoute,
      async (request, reply) =>
        respond(reply, async () => {
          const updated = await container.setConversationMode(
            pathParameter(request, "conversationId"),
            parseConversationMode(request.body),
          );
          return conversationPayload(updated);
        }),
    );
  }

  server.get(
    `${prefix}/conversations/:conversationId/messages`,
    protectedRoute,
    async (request, reply) =>
      respond(reply, async () => {
        const conversation = await requireConversation(container, request);
        const messages = await container.memory.messages.listByConversation(conversation.id, {
          order: "asc",
        });
        const emptyMessagesByTimestamp = new Map<string, number>();
        for (const message of messages) {
          if (message.content.trim().length > 0) continue;
          emptyMessagesByTimestamp.set(
            message.createdAt,
            (emptyMessagesByTimestamp.get(message.createdAt) ?? 0) + 1,
          );
        }
        return messages.flatMap((message) => {
          if (
            message.content.trim().length === 0 &&
            (emptyMessagesByTimestamp.get(message.createdAt) ?? 0) > 5
          ) {
            return [];
          }
          const media =
            message.providerMessageId === undefined
              ? undefined
              : container.provider.getMediaInfo?.(
                  message.connectionId,
                  message.providerMessageId,
                );
          if (message.content.trim().length === 0 && media === undefined) return [];
          return [
            messagePayload(
              message,
              media
                ? `${prefix}/conversations/${encodeURIComponent(conversation.id)}/messages/${encodeURIComponent(message.id)}/media`
                : undefined,
              media,
            ),
          ];
        });
      }),
  );

  server.get(
    `${prefix}/conversations/:conversationId/messages/:messageId/media`,
    protectedRoute,
    async (request, reply) =>
      respond(reply, async () => {
        const conversation = await requireConversation(container, request);
        const params = asRecord(request.params);
        const messageId = typeof params.messageId === "string" ? params.messageId : "";
        const message = await container.memory.messages.findById(messageId);
        if (
          !message ||
          message.conversationId !== conversation.id ||
          !message.providerMessageId ||
          !container.provider.downloadMedia
        ) {
          throw notFound("Midia do WhatsApp nao encontrada.");
        }
        try {
          const media = await container.provider.downloadMedia(
            message.connectionId,
            message.providerMessageId,
          );
          reply.header("Cache-Control", "private, max-age=300");
          if (media.info.fileName) {
            reply.header(
              "Content-Disposition",
              `inline; filename="${media.info.fileName.replaceAll('"', "")}"`,
            );
          }
          return reply.type(media.info.mimeType).send(media.data);
        } catch {
          throw unavailable("A midia nao esta mais disponivel nesta sessao.");
        }
      }),
  );

  server.post(`${prefix}/history`, protectedRoute, async (_request, reply) =>
    respond(reply, async () =>
      reply.code(202).send(await container.fetchAllConversationHistory()),
    ),
  );

  for (const suffix of ["messages", "send"] as const) {
    server.post(
      `${prefix}/conversations/:conversationId/${suffix}`,
      protectedRoute,
      async (request, reply) =>
        respond(reply, async () => {
          const message = await container.sendManualMessage({
            conversationId: pathParameter(request, "conversationId"),
            content: parseManualMessage(request.body),
          });
          return reply.code(201).send(messagePayload(message));
        }),
    );
  }

  for (const suffix of ["reset", "reset-session"] as const) {
    server.post(
      `${prefix}/conversations/:conversationId/${suffix}`,
      protectedRoute,
      async (request, reply) =>
        respond(reply, async () =>
          conversationPayload(
            await container.resetConversationSession(pathParameter(request, "conversationId")),
          ),
        ),
    );
  }
}

async function statusPayload(
  container: WhatsAppContainer,
  connectionId: string,
): Promise<Record<string, unknown>> {
  const [connection, settings] = await Promise.all([
    requireConnection(container, connectionId),
    container.memory.settings.get(),
  ]);
  const snapshot = container.provider.getSnapshot(connection.id);
  const providerStatus = snapshot?.status ?? connection.status;
  const qr = snapshot?.qr?.value ?? null;
  return {
    id: connection.id,
    connectionId: connection.id,
    name: connection.name,
    accountName: connection.name,
    channel: "WhatsApp Web",
    method: "QR code",
    status: providerStatus,
    connectionStatus: connection.status,
    enabled: settings.enabled,
    globalEnabled: settings.enabled,
    paused: settings.pauseAll,
    qr,
    qrCode: qr,
    ...(snapshot?.qr?.expiresAt === undefined ? {} : { qrExpiresAt: snapshot.qr.expiresAt }),
    ...(snapshot?.address === undefined ? {} : { address: snapshot.address }),
    ...(snapshot?.error === undefined ? {} : { error: snapshot.error }),
    historySyncStatus: snapshot?.historySyncStatus ?? "idle",
    ...(snapshot?.historySyncProgress === undefined
      ? {}
      : { historySyncProgress: snapshot.historySyncProgress }),
  };
}

async function qrPayload(
  container: WhatsAppContainer,
  connectionId: string,
): Promise<Record<string, unknown>> {
  await requireConnection(container, connectionId);
  const snapshot = container.provider.getSnapshot(connectionId);
  const qr = snapshot?.qr?.value ?? null;
  return {
    connectionId,
    qr,
    qrCode: qr,
    expiresAt: snapshot?.qr?.expiresAt ?? null,
  };
}

function settingsPayload(settings: ChannelSettings): Record<string, unknown> {
  return {
    ...settings,
    globalEnabled: settings.enabled,
    paused: settings.pauseAll,
    mode: settings.defaultConversationMode,
  };
}

function conversationPayload(conversation: ChannelConversation): Record<string, unknown> {
  const avatarUrl =
    typeof conversation.metadata.avatarUrl === "string"
      ? conversation.metadata.avatarUrl
      : undefined;
  return {
    ...conversation,
    conversationId: conversation.id,
    name:
      conversation.displayName ??
      conversation.normalizedPhone ??
      conversation.externalConversationId,
    contactName: conversation.displayName,
    phone: conversation.normalizedPhone ?? conversation.externalConversationId,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    preview: conversation.lastMessagePreview,
    unread: conversation.unreadCount,
    mode: toUiMode(conversation.automationMode),
  };
}

function conversationActivity(conversation: ChannelConversation): string {
  return conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt;
}

function isUsableContact(value: string): boolean {
  if (value.endsWith("@lid")) return false;
  const normalized = value.replace(/@(?:lid|s\.whatsapp\.net|c\.us)$/i, "");
  return /^\d{8,15}$/.test(normalized);
}

function messagePayload(
  message: ChannelMessage,
  mediaUrl?: string,
  media?: { readonly kind: string; readonly mimeType: string; readonly fileName?: string },
): Record<string, unknown> {
  return {
    ...message,
    body: message.content,
    direction: message.direction === "inbound" ? "incoming" : "outgoing",
    sentAt: message.createdAt,
    ...(mediaUrl === undefined || media === undefined
      ? {}
      : {
          media: {
            url: mediaUrl,
            type: media.kind,
            mimeType: media.mimeType,
            ...(media.fileName === undefined ? {} : { fileName: media.fileName }),
          },
        }),
  };
}

async function requireConnection(
  container: WhatsAppContainer,
  connectionId: string,
): Promise<ChannelConnection> {
  const connection = await container.memory.connections.findById(connectionId);
  if (!connection || connection.channelId !== WHATSAPP_CHANNEL_ID) {
    throw notFound("Conexao WhatsApp nao encontrada.");
  }
  return connection;
}

async function requireConversation(
  container: WhatsAppContainer,
  request: FastifyRequest,
): Promise<ChannelConversation> {
  const conversationId = pathParameter(request, "conversationId");
  const conversation = await container.memory.conversations.findById(conversationId);
  if (!conversation || conversation.channelId !== WHATSAPP_CHANNEL_ID) {
    throw notFound("Conversa WhatsApp nao encontrada.");
  }
  const query = asRecord(request.query);
  if (
    query.connectionId !== undefined &&
    conversation.connectionId !== parseConnectionId(query.connectionId)
  ) {
    throw notFound("Conversa WhatsApp nao encontrada.");
  }
  return conversation;
}

async function respond<T>(
  reply: FastifyReply,
  action: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof WhatsAppApiError)) throw error;
    return reply.code(error.statusCode).send({
      code: error.code,
      message: error.message,
    });
  }
}

function pathParameter(request: FastifyRequest, name: string): string {
  const params = asRecord(request.params);
  return name === "conversationId"
    ? parseConversationId(params[name])
    : parseConnectionId(params[name]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
