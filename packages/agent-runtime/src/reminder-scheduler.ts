import type {
  Clock, ReminderDeliveryProvider, ReminderDueEvaluator, ReminderOccurrenceRepository, ReminderRepository, Scheduler,
} from "@flowmind/agent-core";

export interface ReminderSchedulerOptions {
  readonly intervalMs?: number;
  readonly recoveryWindowMs?: number;
}

export class ReminderScheduler implements Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly intervalMs: number;
  private readonly recoveryWindowMs: number;

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
  }

  public async start(): Promise<void> {
    if (this.timer) return;
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
      const occurrence = this.evaluator.evaluate(reminder, now);
      if (!occurrence) continue;
      const existing = await this.occurrences.findByReminderAndScheduledFor(occurrence.reminderId, occurrence.scheduledFor);
      if (existing) continue;
      await this.occurrences.save(occurrence);
      try { await this.delivery.deliver(occurrence, reminder); }
      catch { await this.occurrences.save({ ...occurrence, status: "failed" }); }
    }
  }
}
