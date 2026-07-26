export interface ExternalMessageKey {
  readonly connectionId: string;
  readonly providerMessageId: string;
}

export const EXTERNAL_MESSAGE_STATUSES = [
  "received",
  "processing",
  "processed",
  "failed",
  "ignored",
] as const;

export type ExternalMessageStatus = (typeof EXTERNAL_MESSAGE_STATUSES)[number];

export interface ExternalMessageRecord extends ExternalMessageKey {
  readonly messageId: string;
  readonly status: ExternalMessageStatus;
  readonly recordedAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

export function externalMessageKey(value: ExternalMessageKey): string {
  return `${value.connectionId}\u0000${value.providerMessageId}`;
}
