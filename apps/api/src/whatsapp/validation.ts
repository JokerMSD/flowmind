import type { ChannelSettings, ConversationMode, RateLimitSettings } from "@flowmind/channel-core";
import { WHATSAPP_PERSONAL_CONNECTION_ID } from "@flowmind/channel-core";

import { badRequest } from "./errors.js";

const conversationModes = new Set<ConversationMode>([
  "disabled",
  "enabled",
  "paused",
  "manual",
  "blocked",
]);

export interface ConversationQuery {
  readonly connectionId: string;
  readonly search?: string;
  readonly mode?: string;
}

export function parseConnectionId(
  candidate: unknown,
  fallback = WHATSAPP_PERSONAL_CONNECTION_ID,
): string {
  if (candidate === undefined) return fallback;
  return requiredString(candidate, "connectionId");
}

export function parseConnectionBody(body: unknown): string {
  if (body === undefined || body === null) return WHATSAPP_PERSONAL_CONNECTION_ID;
  const value = record(body);
  return parseConnectionId(value.connectionId);
}

export function parseConversationId(candidate: unknown): string {
  return requiredString(candidate, "conversationId");
}

export function parseConversationQuery(query: unknown): ConversationQuery {
  const value = record(query);
  const search = optionalString(value.search, "search");
  const mode = optionalString(value.mode ?? value.automationMode, "mode");
  if (
    mode !== undefined &&
    mode !== "all" &&
    mode !== "agent" &&
    !conversationModes.has(mode as ConversationMode)
  ) {
    throw badRequest("Modo de conversa invalido.");
  }
  return {
    connectionId: parseConnectionId(value.connectionId),
    ...(search === undefined ? {} : { search }),
    ...(mode === undefined || mode === "all" ? {} : { mode }),
  };
}

export function parseConversationMode(body: unknown): ConversationMode {
  const value = record(body);
  const candidate = value.mode ?? value.automationMode;
  if (candidate === "agent") return "enabled";
  if (typeof candidate !== "string" || !conversationModes.has(candidate as ConversationMode)) {
    throw badRequest("Modo de conversa invalido.");
  }
  return candidate as ConversationMode;
}

export function parseManualMessage(body: unknown): string {
  const value = record(body);
  const candidate = value.body ?? value.message ?? value.content;
  return requiredString(candidate, "body");
}

export function parseSettingsUpdate(
  body: unknown,
  current: ChannelSettings,
): Partial<ChannelSettings> {
  const value = record(body);
  const update: MutableSettings = {};

  const enabled = booleanAlias(value.enabled, value.globalEnabled, "enabled");
  if (enabled !== undefined) update.enabled = enabled;
  const pauseAll = booleanAlias(value.pauseAll, value.paused, "pauseAll");
  if (pauseAll !== undefined) update.pauseAll = pauseAll;

  if (value.defaultAgentId !== undefined) {
    update.defaultAgentId = requiredString(value.defaultAgentId, "defaultAgentId");
  }
  if (value.defaultConversationMode !== undefined) {
    update.defaultConversationMode = parseModeValue(value.defaultConversationMode);
  }
  if (value.allowGroups !== undefined) {
    update.allowGroups = requiredBoolean(value.allowGroups, "allowGroups");
  }
  if (value.processMessagesFromSelf !== undefined) {
    update.processMessagesFromSelf = requiredBoolean(
      value.processMessagesFromSelf,
      "processMessagesFromSelf",
    );
  }
  if (value.rateLimit !== undefined) {
    const limits = record(value.rateLimit);
    update.rateLimit = {
      auto:
        limits.auto === undefined
          ? current.rateLimit.auto
          : parseRateLimit(limits.auto, "rateLimit.auto"),
      global:
        limits.global === undefined
          ? current.rateLimit.global
          : parseRateLimit(limits.global, "rateLimit.global"),
    };
  }
  if (Object.keys(update).length === 0) {
    throw badRequest("Informe ao menos uma configuracao para atualizar.");
  }
  return update;
}

export function modeMatches(
  automationMode: ConversationMode,
  requested: string | undefined,
): boolean {
  if (!requested) return true;
  if (requested === "agent") return automationMode === "enabled";
  return automationMode === requested;
}

export function toUiMode(mode: ConversationMode): "agent" | "manual" | "paused" {
  if (mode === "enabled") return "agent";
  if (mode === "manual") return "manual";
  return "paused";
}

type MutableSettings = {
  -readonly [Key in keyof ChannelSettings]?: ChannelSettings[Key];
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest();
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} deve ser uma string nao vazia.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw badRequest(`${field} deve ser uma string.`);
  return value.trim();
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw badRequest(`${field} deve ser booleano.`);
  return value;
}

function booleanAlias(primary: unknown, alias: unknown, field: string): boolean | undefined {
  if (primary === undefined && alias === undefined) return undefined;
  if (primary !== undefined && alias !== undefined && primary !== alias) {
    throw badRequest(`Aliases conflitantes para ${field}.`);
  }
  return requiredBoolean(primary ?? alias, field);
}

function parseModeValue(value: unknown): ConversationMode {
  if (value === "agent") return "enabled";
  if (typeof value !== "string" || !conversationModes.has(value as ConversationMode)) {
    throw badRequest("defaultConversationMode invalido.");
  }
  return value as ConversationMode;
}

function parseRateLimit(value: unknown, field: string): RateLimitSettings {
  const limit = record(value);
  if (
    !Number.isSafeInteger(limit.maxMessages) ||
    (limit.maxMessages as number) < 0 ||
    !Number.isSafeInteger(limit.windowMs) ||
    (limit.windowMs as number) <= 0
  ) {
    throw badRequest(`${field} requer maxMessages >= 0 e windowMs > 0.`);
  }
  return {
    maxMessages: limit.maxMessages as number,
    windowMs: limit.windowMs as number,
  };
}
