import type { Reminder, ReminderRepository, Weekday } from "@flowmind/agent-core";
import type { ReminderService } from "@flowmind/agent-runtime";
import type { AgentChatRequest } from "@flowmind/channel-runtime";

const weekdays: Readonly<Record<string, Weekday>> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

export class WhatsAppReminderCommands {
  public constructor(
    private readonly service: ReminderService,
    private readonly reminders: ReminderRepository,
    private readonly now: () => Date,
  ) {}

  public async handle(request: AgentChatRequest): Promise<string | undefined> {
    if (!request.target) return undefined;
    const message = normalize(request.message);
    const related = await this.related(request);

    if (message.includes("qual meu proximo lembrete")) return this.next(related);
    if (message.includes("liste meus lembretes") || message.includes("listar meus lembretes")) {
      return list(related);
    }
    if (message.includes("desative meus lembretes")) {
      await Promise.all(related.map((item) => this.service.setStatus(item.id, false)));
      return statusResult(related, "desativados");
    }
    if (message.includes("ative meus lembretes")) {
      await Promise.all(related.map((item) => this.service.setStatus(item.id, true)));
      return statusResult(related, "ativados");
    }
    if (message.includes("remova meu lembrete")) {
      const latest = related.at(-1);
      if (!latest) return notFound();
      await this.service.remove(latest.id);
      return "Seu lembrete mais recente foi removido.";
    }

    const schedule = parseSchedule(message);
    if (!schedule || !message.includes("lembra")) return undefined;
    const reminder = await this.service.create({
      agentId: request.agentId,
      type: "shape-photo",
      message: "Hora de registrar a foto do shape.",
      schedule: {
        daysOfWeek: schedule.days,
        times: [schedule.time],
        timezone: "America/Sao_Paulo",
      },
      enabled: true,
      target: request.target,
    });
    return `Lembrete criado para ${formatDays(reminder.schedule.daysOfWeek)} as ${schedule.time}.`;
  }

  private async related(request: AgentChatRequest): Promise<readonly Reminder[]> {
    const target = request.target;
    if (!target) return [];
    return (await this.reminders.list(request.agentId))
      .filter((item) => {
        const itemTarget = item.target;
        return (
          itemTarget?.channelId === target.channelId &&
          itemTarget.connectionId === target.connectionId &&
          itemTarget.conversationId === target.conversationId
        );
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private next(reminders: readonly Reminder[]): string {
    const candidates = reminders
      .filter((item) => item.enabled)
      .flatMap((item) => occurrences(item, this.now()));
    const nextDate = candidates.sort((left, right) => left.getTime() - right.getTime())[0];
    return nextDate ? `Seu proximo lembrete e ${formatDate(nextDate)}.` : notFound(true);
  }
}

function parseSchedule(message: string): { days: readonly Weekday[]; time: string } | undefined {
  const match = message.match(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h([0-5]\d)?)?\b/);
  const hour = match?.[1]?.padStart(2, "0");
  if (!hour) return undefined;
  const minute = (match?.[2] ?? match?.[3] ?? "00").padEnd(2, "0");
  const days: readonly Weekday[] = message.includes("todo dia")
    ? [0, 1, 2, 3, 4, 5, 6]
    : Object.entries(weekdays)
        .filter(([name]) => message.includes(name))
        .map(([, day]) => day);
  return days.length ? { days, time: `${hour}:${minute}` } : undefined;
}

function occurrences(reminder: Reminder, now: Date): Date[] {
  const result: Date[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    if (!reminder.schedule.daysOfWeek.includes(day.getDay() as Weekday)) continue;
    for (const time of reminder.schedule.times) {
      const [hours = 0, minutes = 0] = time.split(":").map(Number);
      const date = new Date(day);
      date.setHours(hours, minutes, 0, 0);
      if (date > now) result.push(date);
    }
  }
  return result;
}

function list(reminders: readonly Reminder[]): string {
  if (!reminders.length) return notFound();
  const items = reminders.map(
    (item, index) =>
      `${index + 1}. ${formatDays(item.schedule.daysOfWeek)} as ${item.schedule.times.join(", ")} - ${item.enabled ? "ativo" : "inativo"}`,
  );
  return `Seus lembretes:\n${items.join("\n")}`;
}

function formatDays(days: readonly Weekday[]): string {
  if (days.length === 7) return "todos os dias";
  const names = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  return days.map((day) => names[day]).join(", ");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function statusResult(reminders: readonly Reminder[], status: string): string {
  return reminders.length ? `Seus lembretes desta conversa foram ${status}.` : notFound();
}

function notFound(active = false): string {
  return `Nao encontrei lembretes${active ? " ativos" : ""} nesta conversa.`;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}
