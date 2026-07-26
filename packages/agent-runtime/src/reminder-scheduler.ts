import type {
  Clock, ReminderDeliveryProvider, ReminderDueEvaluator, ReminderOccurrenceRepository, ReminderRepository, Scheduler,
} from "@flowmind/agent-core";

export interface ReminderSchedulerOptions {
  readonly intervalMs?: number;
  readonly recoveryWindowMs?: number;
  readonly onError?: (error: unknown, reminderId: string) => void;
  /**
   * A pending occurrence is terminally failed after this age. Existing
   * occurrences are never delivered again, so scheduler recovery has no retry.
   */
  readonly pendingFailureAfterMs?: number;
}

export const DEFAULT_PENDING_FAILURE_AFTER_MS = 10 * 60_000;

export class ReminderScheduler implements Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly intervalMs: number;
  private readonly recoveryWindowMs: number;
  private readonly pendingFailureAfterMs: number;
  private readonly onError: (error: unknown, reminderId: string) => void;

  public constructor(
    private readonly reminders: ReminderRepository,
    private readonly occurrences: ReminderOccurrenceRepository,
    private readonly evaluator: ReminderDueEvaluator,
    private readonly delivery: ReminderDeliveryProvider,
    private readonly clock: Clock,
    options: ReminderSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.recoveryWindowMs = options.recoveryWindowMs ?? 10 * 60_000;
    this.pendingFailureAfterMs = options.pendingFailureAfterMs ?? DEFAULT_PENDING_FAILURE_AFTER_MS;
    this.onError = options.onError ?? ((error, reminderId) => {
      console.error(`Reminder scheduler failed for ${reminderId}`, error);
    });
  }

  public async start(): Promise<void> {
    if (this.timer) return;
    await this.failStalePendingOccurrences(this.clock.now());
    await this.runRecovery();
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
  }

  public async stop(): Promise<void> {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  public async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.evaluateAt(this.clock.now()); } finally { this.running = false; }
  }

  private async runRecovery(): Promise<void> {
    const now = this.clock.now();
    for (let elapsed = this.recoveryWindowMs; elapsed >= 0; elapsed -= 60_000) await this.evaluateAt(new Date(now.getTime() - elapsed));
  }

  private async evaluateAt(now: Date): Promise<void> {
    const reminders = await this.reminders.list();
    for (const reminder of reminders) {
      try {
        const occurrence = this.evaluator.evaluate(reminder, now);
        if (!occurrence) continue;
        const existing = await this.occurrences.findByReminderAndScheduledFor(occurrence.reminderId, occurrence.scheduledFor);
        if (existing) continue;
        await this.occurrences.save(occurrence);
        try { await this.delivery.deliver(occurrence, reminder); }
        catch { await this.occurrences.save({ ...occurrence, status: "failed" }); }
      } catch (error) {
        this.onError(error, reminder.id);
        continue;
      }
    }
  }

  private async failStalePendingOccurrences(now: Date): Promise<void> {
    const staleAt = now.getTime() - this.pendingFailureAfterMs;
    const pending = await this.occurrences.list({ status: "pending" });
    for (const occurrence of pending) {
      if (Date.parse(occurrence.detectedAt) > staleAt) continue;
      try {
        await this.occurrences.save({ ...occurrence, status: "failed" });
      } catch (error) {
        this.onError(error, occurrence.reminderId);
        continue;
      }
    }
  }
}
