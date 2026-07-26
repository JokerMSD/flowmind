import type { RateLimitSettings } from "@flowmind/channel-core";

export interface RateLimiter {
  allow(scopeId: string, settings: RateLimitSettings, now: Date): boolean;
}

export type ConversationRateLimiter = RateLimiter;

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  public allow(scopeId: string, settings: RateLimitSettings, now: Date): boolean {
    if (settings.maxMessages <= 0 || settings.windowMs <= 0) return true;
    const threshold = now.getTime() - settings.windowMs;
    const current = (this.attempts.get(scopeId) ?? []).filter((value) => value > threshold);
    if (current.length >= settings.maxMessages) {
      this.attempts.set(scopeId, current);
      return false;
    }
    current.push(now.getTime());
    this.attempts.set(scopeId, current);
    return true;
  }
}
