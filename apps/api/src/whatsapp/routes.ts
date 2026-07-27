import type {
  ChannelConnection,
  ChannelConversation,
  ChannelMessage,
  ChannelSettings,
} from "@flowmind/channel-core";
import { WHATSAPP_CHANNEL_ID } from "@flowmind/channel-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createAdminAuthHook, type AdminAuth } from "../admin/index.js";
import { WhatsAppApiError, notFound } from "./errors.js";
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
      const conversations = await container.memory.conversations.list({
        connectionId: query.connectionId,
        ...(query.search === undefined ? {} : { search: query.search }),
        order: "desc",
      });
      return conversations
        .filter((conversation) => modeMatches(conversation.automationMode, query.mode))
        .map(conversationPayload);
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
        return messages.map(messagePayload);
      }),
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
  return {
    ...conversation,
    conversationId: conversation.id,
    name:
      conversation.displayName ??
      conversation.normalizedPhone ??
      conversation.externalConversationId,
    contactName: conversation.displayName,
    phone: conversation.normalizedPhone ?? conversation.externalConversationId,
    preview: conversation.lastMessagePreview,
    unread: conversation.unreadCount,
    mode: toUiMode(conversation.automationMode),
  };
}

function messagePayload(message: ChannelMessage): Record<string, unknown> {
  return {
    ...message,
    body: message.content,
    direction: message.direction === "inbound" ? "incoming" : "outgoing",
    sentAt: message.createdAt,
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
