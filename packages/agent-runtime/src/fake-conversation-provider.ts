import type { ConversationContext, ConversationOutput, ConversationProvider, ConversationRule } from "./conversation.js";

export class FakeConversationProvider implements ConversationProvider {
  public readonly id = "fake";
  private readonly rules: readonly ConversationRule[];

  public constructor(rules: readonly ConversationRule[] = defaultConversationRules) {
    this.rules = [...rules].sort((left, right) => right.priority - left.priority);
  }

  public async generateResponse(context: ConversationContext): Promise<ConversationOutput> {
    const rule = this.rules.find((candidate) => candidate.matches(context));
    return { content: rule ? await rule.respond(context) : fallbackResponse(context) };
  }
}

function rule(id: string, priority: number, terms: readonly string[], response: string): ConversationRule {
  return {
    id,
    priority,
    matches: (context) => includesTerm(context.message.content, terms),
    respond: async () => response,
  };
}

function includesTerm(content: string, terms: readonly string[]): boolean {
  const normalized = content
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
  return terms.some((term) => normalized.includes(term));
}

function fallbackResponse(context: ConversationContext): string {
  const previousAgentMessage = [...context.session.messages]
    .reverse()
    .find((message) => message.role === "agent");
  return previousAgentMessage
    ? "To contigo nessa. Quer me contar como foi seu ultimo treino?"
    : "Fala! Como esta o shape hoje?";
}

export const defaultConversationRules: readonly ConversationRule[] = [
  rule("reminder", 30, ["lembra", "lembrete"], "Voce pode configurar aqui os dias e horarios do lembrete da foto do shape."),
  rule("shape-photo", 20, ["foto", "shape"], "Boa! Registrar fotos ajuda a acompanhar sua evolucao."),
  rule("training", 10, ["trein", "academia", "muscul"], "Bora! Qual grupo muscular voce pretende treinar hoje?"),
  rule("greeting", 1, ["ola", "oi", "e ai"], "Fala! Como esta o shape hoje?"),
];
