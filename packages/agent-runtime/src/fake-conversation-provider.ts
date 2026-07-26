import type {
  ConversationContext,
  ConversationOutput,
  ConversationProvider,
  ConversationRule,
} from "./conversation.js";

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

function rule(
  id: string,
  priority: number,
  terms: readonly string[],
  response: string,
): ConversationRule {
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
  rule(
    "health-warning",
    100,
    ["dor", "lesao", "tontura", "falta de ar", "mal-estar", "mal estar"],
    "Interrompa o treino agora. Procure avaliacao de um profissional de saude, especialmente se os sintomas forem intensos ou persistirem.",
  ),
  rule(
    "reminder",
    30,
    ["lembra", "lembrete"],
    "Voce pode configurar aqui os dias e horarios do lembrete da foto do shape.",
  ),
  rule(
    "shape-photo",
    20,
    ["foto", "shape"],
    "Boa! Registrar fotos ajuda a acompanhar sua evolucao.",
  ),
  rule(
    "chest",
    16,
    ["peito"],
    "No treino de peito, priorize tecnica, amplitude controlada e progressao compativel com seu nivel.",
  ),
  rule(
    "back",
    16,
    ["costas"],
    "Para costas, combine puxadas e remadas com execucao controlada e postura estavel.",
  ),
  rule(
    "legs",
    16,
    ["perna", "quadriceps", "posterior"],
    "No treino de pernas, aqueça bem e mantenha a tecnica antes de aumentar a carga.",
  ),
  rule(
    "shoulders",
    16,
    ["ombro"],
    "Para ombros, controle a carga e preserve uma amplitude confortavel, sem insistir em dor.",
  ),
  rule(
    "arms",
    16,
    ["braco", "biceps", "triceps"],
    "Para bracos, use movimentos controlados e evite compensar com o tronco.",
  ),
  rule(
    "rest",
    15,
    ["descanso", "descansar"],
    "Descanso faz parte da evolucao. Sono e recuperacao ajudam a sustentar a frequencia.",
  ),
  rule(
    "frequency",
    15,
    ["frequencia", "quantas vezes"],
    "Uma frequencia consistente e recuperavel costuma ser mais util que treinar alem da capacidade de recuperacao.",
  ),
  rule(
    "motivation",
    15,
    ["motiv", "desanim"],
    "Mantenha o objetivo pequeno e executavel hoje. Consistencia vale mais que um treino perfeito.",
  ),
  rule(
    "progress",
    15,
    ["evolu", "progres"],
    "Compare registros ao longo de semanas: carga, repeticoes, medidas e fotos nas mesmas condicoes.",
  ),
  rule(
    "training",
    10,
    ["trein", "academia", "muscul"],
    "Bora! Qual grupo muscular voce pretende treinar hoje?",
  ),
  rule("greeting", 1, ["ola", "oi", "e ai"], "Fala! Como esta o shape hoje?"),
];
