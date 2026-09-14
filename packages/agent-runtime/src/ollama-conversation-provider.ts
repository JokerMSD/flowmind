import type { ChatMessage } from "@flowmind/agent-core";
import type {
  ConversationInput,
  ConversationOutput,
  ConversationProvider,
} from "./conversation.js";

interface OllamaMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: unknown;
  };
}

export interface OllamaConversationProviderOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fallback?: ConversationProvider;
  readonly fetch?: typeof fetch;
}

export class OllamaConversationProvider implements ConversationProvider {
  public readonly id = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fallback: ConversationProvider | undefined;
  private readonly fetch: typeof fetch;

  public constructor(options: OllamaConversationProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.model = options.model ?? "gemma4:e2b-it-qat";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fallback = options.fallback;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  public async generateResponse(input: ConversationInput): Promise<ConversationOutput> {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: systemPrompt(input) },
            ...input.session.messages.map(toOllamaMessage),
          ],
          options: {
            temperature: 0.6,
            num_ctx: 8_192,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as OllamaChatResponse;
      const content =
        typeof payload.message?.content === "string" ? payload.message.content.trim() : "";
      if (!content) throw new Error("Ollama returned an empty response");
      return { content };
    } catch (error) {
      if (this.fallback) return this.fallback.generateResponse(input);
      throw error;
    }
  }
}

function toOllamaMessage(message: ChatMessage): OllamaMessage {
  return {
    role: message.role === "agent" ? "assistant" : message.role,
    content: message.content,
  };
}

function systemPrompt(input: ConversationInput): string {
  const personality = input.agent.personality;
  return [
    `Voce e ${input.agent.name}, ${input.agent.description}`,
    `Fale em portugues do Brasil com estilo ${personality.speechStyle}.`,
    `Seus tracos principais sao: ${personality.traits.join(", ")}.`,
    `Seu humor e ${personality.humor} e seu nivel de energia e ${personality.energyLevel}.`,
    `Seus interesses sao: ${personality.likes.join(", ")}.`,
    `Evite: ${personality.dislikes.join(", ")}.`,
    `Sua rotina de acompanhamento inclui: ${personality.routine.join(", ")}.`,
    ...(typeof input.agent.metadata.customInstructions === "string"
      ? [`Instrucoes personalizadas obrigatorias: ${input.agent.metadata.customInstructions}`]
      : []),
    "Responda de forma curta, natural e util, como um companheiro de treino.",
    "Converse de forma espontanea e adapte tom, vocabulario e tamanho da resposta ao jeito da pessoa.",
    "Nao siga um roteiro fixo, nao repita saudacoes, bordoes, estruturas ou explicacoes ja dadas.",
    "Use detalhes do historico apenas quando forem relevantes e nunca finja lembrar do que nao esta registrado.",
    "Faca no maximo uma pergunta util por resposta e somente quando ela ajudar a conversa a avancar.",
    "Aceite respostas curtas, mudancas de assunto, humor e linguagem informal sem tentar conduzir tudo para treino.",
    "Nunca presuma genero, pronome ou forma de tratamento pelo nome, foto, telefone ou contexto.",
    'Enquanto a pessoa nao informar como prefere ser tratada, use "voce" e construcoes neutras.',
    'Evite vocativos marcados por genero, como "amigo", "irmao", "campeao", "mano" ou "cara".',
    "Quando a forma de tratamento for relevante, pergunte naturalmente como a pessoa prefere ser chamada.",
    "Nao repita essa pergunta se a resposta ja estiver no historico da conversa.",
    "Se a propria pessoa informar genero, pronome ou tratamento, respeite essa informacao nas respostas seguintes.",
    "Nao diga que executou acoes, criou lembretes ou usou ferramentas quando isso nao aconteceu.",
    "Em sintomas, dor ou risco a saude, recomende interromper a atividade e procurar um profissional.",
  ].join("\n");
}
