import {
  AgentDisabledError, AgentNotFoundError, ReminderNotFoundError, normalizeReminderMessage, normalizeReminderSchedule,
} from "@flowmind/agent-core";
import type {
  AgentRepository, Clock, Reminder, ReminderRepository, ReminderScheduleInput,
} from "@flowmind/agent-core";
import type { IdentifierGenerator } from "./agent-runtime.js";

export interface ReminderInput {
  readonly agentId: string;
  readonly type: "shape-photo";
  readonly message: string;
  readonly schedule: ReminderScheduleInput;
  readonly enabled: boolean;
}

export class ReminderService {
  public constructor(
    private readonly agents: AgentRepository,
    private readonly reminders: ReminderRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async create(input: ReminderInput): Promise<Reminder> {
    await this.requireEnabledAgent(input.agentId);
    const now = this.clock.now().toISOString();
    const reminder = this.build(this.identifiers.next(), input, now, now);
    await this.reminders.save(reminder);
    return reminder;
  }

  public async update(id: string, input: ReminderInput): Promise<Reminder> {
    const current = await this.requireReminder(id);
    await this.requireEnabledAgent(input.agentId);
    const updated = this.build(current.id, input, current.createdAt, this.clock.now().toISOString());
    await this.reminders.save(updated);
    return updated;
  }

  public async setStatus(id: string, enabled: boolean): Promise<Reminder> {
    const reminder = await this.requireReminder(id);
    const updated = { ...reminder, enabled, updatedAt: this.clock.now().toISOString() };
    await this.reminders.save(updated);
    return updated;
  }

  public async remove(id: string): Promise<void> {
    await this.requireReminder(id);
    await this.reminders.delete(id);
  }

  private build(id: string, input: ReminderInput, createdAt: string, updatedAt: string): Reminder {
    return {
      id, agentId: input.agentId, type: input.type, message: normalizeReminderMessage(input.message),
      schedule: normalizeReminderSchedule(input.schedule), enabled: input.enabled, createdAt, updatedAt,
    };
  }

  private async requireEnabledAgent(agentId: string): Promise<void> {
    const agent = await this.agents.findById(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);
    if (!agent.enabled) throw new AgentDisabledError(agentId);
  }

  private async requireReminder(id: string): Promise<Reminder> {
    const reminder = await this.reminders.findById(id);
    if (!reminder) throw new ReminderNotFoundError(id);
    return reminder;
  }
}
