import type { AgentDefinition } from "@flowmind/agent-core";
import type { EnergyLevel } from "@flowmind/schema";
import type { AgentContainer } from "../agents/container.js";

type FieldControl = "toggle" | "text" | "textarea" | "number" | "tags" | "select";

export interface RuntimeWorkspaceField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly control: FieldControl;
  readonly editable: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface RuntimeWorkspaceNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly status: "active" | "inactive";
  readonly position: { readonly x: number; readonly y: number };
  readonly config: Readonly<Record<string, unknown>>;
  readonly fields: readonly RuntimeWorkspaceField[];
  readonly removable?: boolean;
}

export interface RuntimeWorkspace {
  readonly id: "csnf" | "reminders";
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly RuntimeWorkspaceNode[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
  }[];
  readonly availableModules: readonly {
    readonly type: string;
    readonly name: string;
    readonly description: string;
  }[];
}

interface AgentUpdate {
  readonly description?: string;
  readonly enabled?: boolean;
  readonly speechStyle?: string;
  readonly humor?: string;
  readonly energyLevel?: EnergyLevel;
  readonly traits?: readonly string[];
  readonly likes?: readonly string[];
  readonly dislikes?: readonly string[];
  readonly routine?: readonly string[];
  readonly mention?: boolean;
  readonly canInitiateConversation?: boolean;
  readonly cooldownMinutes?: number;
  readonly customInstructions?: string;
}

export async function runtimeWorkspaces(
  container: AgentContainer,
): Promise<readonly RuntimeWorkspace[]> {
  const agent = await requireCsnf(container);
  const reminders = await container.reminders.list(agent.id);
  return [csnfWorkspace(agent), remindersWorkspace(agent, reminders.length)];
}

export async function updateCsnfWorkspace(
  container: AgentContainer,
  body: unknown,
): Promise<RuntimeWorkspace> {
  const update = parseAgentUpdate(body);
  const agent = await requireCsnf(container);
  const next: AgentDefinition = {
    ...agent,
    ...(update.description === undefined ? {} : { description: update.description }),
    ...(update.enabled === undefined
      ? {}
      : { enabled: update.enabled, settings: { ...agent.settings, enabled: update.enabled } }),
    personality: {
      ...agent.personality,
      ...(update.speechStyle === undefined ? {} : { speechStyle: update.speechStyle }),
      ...(update.humor === undefined ? {} : { humor: update.humor }),
      ...(update.energyLevel === undefined ? {} : { energyLevel: update.energyLevel }),
      ...(update.traits === undefined ? {} : { traits: update.traits }),
      ...(update.likes === undefined ? {} : { likes: update.likes }),
      ...(update.dislikes === undefined ? {} : { dislikes: update.dislikes }),
      ...(update.routine === undefined ? {} : { routine: update.routine }),
    },
    activationPolicy: {
      ...agent.activationPolicy,
      ...(update.mention === undefined ? {} : { mention: update.mention }),
      ...(update.canInitiateConversation === undefined
        ? {}
        : { canInitiateConversation: update.canInitiateConversation }),
      ...(update.cooldownMinutes === undefined ? {} : { cooldownMinutes: update.cooldownMinutes }),
    },
    metadata: {
      ...agent.metadata,
      ...(update.customInstructions === undefined
        ? {}
        : { customInstructions: update.customInstructions }),
    },
  };
  await container.agents.save(next);
  return csnfWorkspace(next);
}

export async function addCsnfModule(
  container: AgentContainer,
  type: string,
): Promise<RuntimeWorkspace> {
  if (type !== "agent.instructions") throw new Error("Modulo nao suportado.");
  const agent = await requireCsnf(container);
  if (typeof agent.metadata.customInstructions === "string")
    throw new Error("O modulo ja foi adicionado.");
  const next = {
    ...agent,
    metadata: {
      ...agent.metadata,
      customInstructions: "Defina aqui as regras adicionais do CSNF.",
    },
  };
  await container.agents.save(next);
  return csnfWorkspace(next);
}

export async function removeCsnfModule(
  container: AgentContainer,
  moduleId: string,
): Promise<RuntimeWorkspace> {
  if (moduleId !== "custom-instructions")
    throw new Error("Este modulo e obrigatorio e nao pode ser removido.");
  const agent = await requireCsnf(container);
  const { customInstructions: _removed, ...metadata } = agent.metadata;
  const next = { ...agent, metadata };
  await container.agents.save(next);
  return csnfWorkspace(next);
}

function csnfWorkspace(agent: AgentDefinition): RuntimeWorkspace {
  const active = agent.enabled ? "active" : "inactive";
  const customInstructions =
    typeof agent.metadata.customInstructions === "string"
      ? agent.metadata.customInstructions
      : undefined;
  const hasInstructions = Boolean(customInstructions);
  const nodes: RuntimeWorkspaceNode[] = [
    node(
      "whatsapp-input",
      "channel.trigger",
      "Mensagem recebida",
      "Inicia o fluxo quando uma nova mensagem chega pelo WhatsApp.",
      "active",
      40,
      180,
      { channel: "WhatsApp" },
      [readonlyField("channel", "Canal", "Canal que inicia este fluxo.")],
    ),
    node(
      "engagement-router",
      "agent.router",
      "Quando o CSNF responde",
      "Decide quando o agente entra, continua ou encerra uma conversa.",
      active,
      300,
      180,
      {
        mention: agent.activationPolicy.mention,
        canInitiateConversation: agent.activationPolicy.canInitiateConversation,
        cooldownMinutes: agent.activationPolicy.cooldownMinutes,
      },
      [
        toggleField(
          "mention",
          "Exigir chamada pelo nome",
          "A primeira mensagem precisa mencionar CSNF.",
        ),
        toggleField(
          "canInitiateConversation",
          "Permitir iniciativa",
          "Autoriza o CSNF a iniciar conversas habilitadas.",
        ),
        numberField(
          "cooldownMinutes",
          "Intervalo entre iniciativas",
          "Tempo minimo, em minutos, antes de uma nova iniciativa.",
        ),
      ],
    ),
    node(
      "csnf-agent",
      "agent.runtime",
      agent.name,
      agent.description,
      active,
      560,
      180,
      {
        enabled: agent.enabled,
        description: agent.description,
        speechStyle: agent.personality.speechStyle,
        humor: agent.personality.humor,
        energyLevel: agent.personality.energyLevel,
        traits: agent.personality.traits,
        likes: agent.personality.likes,
        dislikes: agent.personality.dislikes,
        routine: agent.personality.routine,
      },
      [
        toggleField("enabled", "Agente ativo", "Desliga ou liga todas as respostas do CSNF."),
        textareaField("description", "Papel do agente", "Quem o CSNF e e qual e sua funcao."),
        textareaField(
          "speechStyle",
          "Jeito de falar",
          "Tom, vocabulario e tamanho esperado das respostas.",
        ),
        textField("humor", "Humor", "Como o humor deve aparecer na conversa."),
        selectField("energyLevel", "Nivel de energia", "Intensidade geral da comunicacao.", [
          { value: "low", label: "Baixa" },
          { value: "medium", label: "Media" },
          { value: "high", label: "Alta" },
        ]),
        tagsField("traits", "Caracteristicas", "Tracos principais da personalidade."),
        tagsField("likes", "Interesses", "Assuntos que combinam com a personalidade."),
        tagsField("dislikes", "Evitar", "Comportamentos e assuntos que o agente deve evitar."),
        tagsField("routine", "Rotina", "Acoes recorrentes que orientam o acompanhamento."),
      ],
    ),
    node(
      "conversation-memory",
      "agent.memory",
      "Memoria da conversa",
      "Recupera o historico da pessoa para manter contexto e continuidade.",
      active,
      820,
      60,
      { strategy: "Historico persistente por conversa" },
      [readonlyField("strategy", "Estrategia", "Forma como o contexto e armazenado.")],
    ),
  ];
  if (hasInstructions)
    nodes.push(
      node(
        "custom-instructions",
        "agent.instructions",
        "Instrucoes personalizadas",
        "Acrescenta regras especificas ao comportamento do CSNF.",
        active,
        820,
        240,
        { customInstructions },
        [
          textareaField(
            "customInstructions",
            "Instrucoes",
            "Regras adicionais enviadas ao modelo em todas as respostas.",
          ),
        ],
        true,
      ),
    );
  nodes.push(
    node(
      "conversation-provider",
      "agent.provider",
      "Modelo de inteligencia",
      "Gera a resposta usando o modelo local configurado no Ollama.",
      active,
      820,
      hasInstructions ? 420 : 300,
      { provider: agent.conversationProvider, model: agent.aiModel.model },
      [
        readonlyField("provider", "Provedor", "Servico que executa o modelo."),
        readonlyField("model", "Modelo", "Modelo carregado pelo runtime atual."),
      ],
    ),
    node(
      "csnf-formatter",
      "agent.formatter",
      "Preparar resposta",
      "Adiciona apresentacao inicial e identificacao das mensagens do agente.",
      active,
      1100,
      180,
      {},
      [],
    ),
    node(
      "whatsapp-output",
      "channel.output",
      "Enviar resposta",
      "Entrega a resposta na mesma conversa do WhatsApp.",
      "active",
      1370,
      180,
      { channel: "WhatsApp" },
      [readonlyField("channel", "Canal", "Destino da resposta.")],
    ),
  );
  return {
    id: "csnf",
    name: "Bot CSNF",
    description: "Fluxo real que recebe mensagens, decide quando responder e executa o agente.",
    nodes,
    edges: [
      edge("whatsapp-input", "engagement-router"),
      edge("engagement-router", "csnf-agent"),
      edge("csnf-agent", "conversation-memory"),
      ...(hasInstructions
        ? [
            edge("csnf-agent", "custom-instructions"),
            edge("custom-instructions", "conversation-provider"),
          ]
        : [edge("csnf-agent", "conversation-provider")]),
      edge("conversation-memory", "csnf-formatter"),
      edge("conversation-provider", "csnf-formatter"),
      edge("csnf-formatter", "whatsapp-output"),
    ],
    availableModules: hasInstructions
      ? []
      : [
          {
            type: "agent.instructions",
            name: "Instrucoes personalizadas",
            description: "Adicione regras proprias ao comportamento do CSNF.",
          },
        ],
  };
}

function remindersWorkspace(agent: AgentDefinition, reminderCount: number): RuntimeWorkspace {
  const status = agent.enabled ? "active" : "inactive";
  return {
    id: "reminders",
    name: "Lembretes",
    description: "Fluxo que encontra lembretes no horario e envia pelo WhatsApp.",
    nodes: [
      node(
        "reminder-scheduler",
        "reminder.scheduler",
        "Verificar horarios",
        "Procura lembretes que precisam ser enviados agora.",
        "active",
        80,
        180,
        { reminders: reminderCount },
        [readonlyField("reminders", "Lembretes cadastrados", "Quantidade atual de lembretes.")],
      ),
      node(
        "recipient-resolver",
        "reminder.target",
        "Encontrar destinatario",
        "Localiza a conversa e a conexao escolhidas no lembrete.",
        "active",
        360,
        180,
        {},
        [],
      ),
      node(
        "reminder-introduction",
        "agent.introduction",
        "Apresentar o CSNF",
        "Envia a apresentacao somente na primeira interacao.",
        status,
        640,
        180,
        {},
        [],
      ),
      node(
        "reminder-delivery",
        "channel.output",
        "Enviar lembrete",
        "Entrega a mensagem e registra o resultado.",
        "active",
        920,
        180,
        { channel: "WhatsApp" },
        [readonlyField("channel", "Canal", "Canal usado na entrega.")],
      ),
    ],
    edges: [
      edge("reminder-scheduler", "recipient-resolver"),
      edge("recipient-resolver", "reminder-introduction"),
      edge("reminder-introduction", "reminder-delivery"),
    ],
    availableModules: [],
  };
}

function node(
  id: string,
  type: string,
  label: string,
  description: string,
  status: RuntimeWorkspaceNode["status"],
  x: number,
  y: number,
  config: Readonly<Record<string, unknown>>,
  fields: readonly RuntimeWorkspaceField[],
  removable = false,
): RuntimeWorkspaceNode {
  return {
    id,
    type,
    label,
    description,
    status,
    position: { x, y },
    config,
    fields,
    ...(removable ? { removable: true } : {}),
  };
}

function field(
  key: string,
  label: string,
  description: string,
  control: FieldControl,
  editable = true,
  options?: RuntimeWorkspaceField["options"],
): RuntimeWorkspaceField {
  return { key, label, description, control, editable, ...(options ? { options } : {}) };
}
const readonlyField = (key: string, label: string, description: string) =>
  field(key, label, description, "text", false);
const toggleField = (key: string, label: string, description: string) =>
  field(key, label, description, "toggle");
const textField = (key: string, label: string, description: string) =>
  field(key, label, description, "text");
const textareaField = (key: string, label: string, description: string) =>
  field(key, label, description, "textarea");
const numberField = (key: string, label: string, description: string) =>
  field(key, label, description, "number");
const tagsField = (key: string, label: string, description: string) =>
  field(key, label, description, "tags");
const selectField = (
  key: string,
  label: string,
  description: string,
  options: NonNullable<RuntimeWorkspaceField["options"]>,
) => field(key, label, description, "select", true, options);
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

async function requireCsnf(container: AgentContainer): Promise<AgentDefinition> {
  const agent = await container.agents.findById("csnf");
  if (!agent) throw new Error("O agente CSNF nao foi inicializado.");
  return agent;
}

function parseAgentUpdate(body: unknown): AgentUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Configuracao invalida.");
  const value = body as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max)
      throw new Error(`Campo invalido: ${key}.`);
    return candidate.trim();
  };
  const boolean = (key: string) => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "boolean") throw new Error(`Campo invalido: ${key}.`);
    return candidate;
  };
  const tags = (key: string) => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (
      !Array.isArray(candidate) ||
      candidate.length > 20 ||
      !candidate.every((item) => typeof item === "string" && item.trim() && item.length <= 80)
    )
      throw new Error(`Campo invalido: ${key}.`);
    return candidate.map((item) => (item as string).trim());
  };
  let energyLevel: EnergyLevel | undefined;
  if (value.energyLevel !== undefined) {
    if (
      value.energyLevel !== "low" &&
      value.energyLevel !== "medium" &&
      value.energyLevel !== "high"
    )
      throw new Error("Nivel de energia invalido.");
    energyLevel = value.energyLevel;
  }
  let cooldownMinutes: number | undefined;
  if (value.cooldownMinutes !== undefined) {
    if (
      !Number.isInteger(value.cooldownMinutes) ||
      (value.cooldownMinutes as number) < 0 ||
      (value.cooldownMinutes as number) > 10_080
    )
      throw new Error("Intervalo invalido.");
    cooldownMinutes = value.cooldownMinutes as number;
  }
  const description = text("description", 500);
  const enabled = boolean("enabled");
  const speechStyle = text("speechStyle", 300);
  const humor = text("humor", 100);
  const traits = tags("traits");
  const likes = tags("likes");
  const dislikes = tags("dislikes");
  const routine = tags("routine");
  const mention = boolean("mention");
  const canInitiateConversation = boolean("canInitiateConversation");
  const customInstructions = text("customInstructions", 4_000);
  const result: AgentUpdate = {
    ...(description === undefined ? {} : { description }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(speechStyle === undefined ? {} : { speechStyle }),
    ...(humor === undefined ? {} : { humor }),
    ...(energyLevel === undefined ? {} : { energyLevel }),
    ...(traits === undefined ? {} : { traits }),
    ...(likes === undefined ? {} : { likes }),
    ...(dislikes === undefined ? {} : { dislikes }),
    ...(routine === undefined ? {} : { routine }),
    ...(mention === undefined ? {} : { mention }),
    ...(canInitiateConversation === undefined ? {} : { canInitiateConversation }),
    ...(cooldownMinutes === undefined ? {} : { cooldownMinutes }),
    ...(customInstructions === undefined ? {} : { customInstructions }),
  };
  return result;
}
