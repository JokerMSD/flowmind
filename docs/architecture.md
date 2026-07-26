# FlowMind Architecture

## Direcao

FlowMind deve ser um projeto independente dentro deste repositorio, isolado na
pasta `flowmind/`.

O bot atual continua existindo na raiz do repositorio. A comunicacao entre os
dois projetos deve acontecer por contratos explicitos, nunca por importacoes
diretas de arquivos internos do bot.

```text
bot-mototaxi/
  config.js
  public/
  src/
  flowmind/
    apps/
    packages/
    docs/
```

## Objetivo

FlowMind e uma plataforma leve e modular para automacao de workflows com IA.
Ela deve funcionar como aplicacao completa e como SDK reutilizavel por outros
projetos.

O editor visual nunca deve ser requisito para executar um fluxo. A engine deve
receber um JSON simples, validar o grafo e executar os nodes registrados.

## Principios

- TypeScript estrito em todos os pacotes da FlowMind.
- Modulos pequenos, com fronteiras explicitas.
- Engine independente de React, Next.js, Fastify ou WhatsApp.
- Nodes distribuidos como pacotes isolados.
- Contratos estaveis em `@flowmind/shared`.
- Registro de executores via registry, sem `switch` central gigante.
- Plugin system preparado desde o inicio, mesmo que a instalacao dinamica venha
  depois.
- Persistencia, UI, transporte HTTP e execucao devem ser substituiveis.
- Integracao com o bot atual apenas por API, SDK, eventos ou adaptadores.

## Monorepo Interno

A pasta `flowmind/` deve ser um monorepo proprio com `pnpm workspace` e TurboRepo.

```text
flowmind/
  apps/
    editor/
    api/
    docs/
packages/
    schema/
    engine/
    sdk/
    shared/
    ui/
    editor-core/
    agent-core/
    agent-runtime/
    agent-memory/
    agent-personality/
    assistant-core/
    node-core/
    node-http/
    node-if/
    node-switch/
    node-gemini/
    node-whatsapp/
    node-delay/
    node-code/
```

## Agentes

FlowMind passa a ter o conceito oficial de `Agent`.

Um agente possui:

- id;
- nome;
- descricao;
- personalidade;
- memoria isolada;
- objetivos;
- ferramentas;
- workflow padrao;
- gatilhos;
- modelo de IA;
- configuracoes;
- voz;
- avatar;
- estado emocional.

A engine deve ser preparada para executar agentes, mas a fase atual nao
implementa runtime, IA, banco, WhatsApp ou execucao real.

## Assistentes Visuais

`@flowmind/assistant-core` prepara a camada de assistentes visuais sem
implementacao concreta.

O primeiro assistente oficial sera o CSNF. Ele deve poder observar contexto do
editor, sugerir acoes e auxiliar o usuario futuramente por contratos como
`Assistant`, `AssistantEvent`, `AssistantPanel`, `AssistantSuggestion`,
`AssistantAction`, `AssistantContext` e `AssistantProvider`.

Regra arquitetural: assistentes nao devem acoplar IA, WhatsApp ou banco ao
editor. Integracoes concretas devem ser plugadas por providers.

## Schema

`@flowmind/schema` e a fonte oficial de definicoes do FlowMind.

Devem existir nele os contratos de:

- Workflow;
- Node;
- Edge;
- Agent;
- Avatar;
- Emotion;
- Trigger;
- Conversation;
- Memory;
- Tool;
- Plugin;
- Execution;
- Variable;
- Secret;
- Metadata;
- Version.

Os demais pacotes devem depender do schema e nao duplicar interfaces.

## Relacao Com O Bot Atual

O bot atual pode conversar com a FlowMind de tres formas:

1. HTTP local ou remoto via `apps/api`.
2. SDK publico via `@flowmind/sdk`, quando o bot puder depender da FlowMind.
3. Adaptador dedicado, por exemplo `node-whatsapp`, para transformar mensagens
   do WhatsApp em eventos de workflow.

Regra arquitetural: `flowmind/` nao deve importar arquivos de `src/`, `public/`
ou `config.js` da raiz. Se algum dado do bot for necessario, ele deve passar por
um contrato publico.

## WhatsApp

O suporte inicial e o canal experimental **WhatsApp Web Channel Alpha 0.3**,
nao oficial, baseado em Baileys `6.7.23`. Ele deve viver em um adaptador
substituivel (por exemplo, `packages/node-whatsapp`) e nao pode acoplar a engine
ao protocolo, ao filesystem de auth ou ao painel.

O adaptador deve modelar `provider`, `connectionId`, estado de conexao,
credencial, eventos de entrada/saida, idempotencia e politicas de opt-in. Cada
`connectionId` possui uma unica instancia, fila e area de auth persistente.
Filesystem efemero, envio em massa e uso em producao nao sao suportados pelo
Alpha. QR, login, reconexao, logout e diagnostico sao operacoes administrativas
protegidas e o QR nunca pertence ao terminal.

O contrato deve permitir coexistencia entre provedores por `connectionId`, com
credenciais e filas separadas. A evolucao comercial recomendada e a WhatsApp
Cloud API oficial, mas ela e apenas um plano nesta fase e **nao esta
implementada**. O roteiro `whatsapp:verify` deve validar somente o que consegue
observar: versao fixada, persistencia, isolamento, protecao, ciclo de vida e
teste opt-in; resultados nao executados devem permanecer explicitamente
`not_run`.

## Camadas

### Shared

`@flowmind/shared` contem apenas contratos puros:

- `FlowDefinition`
- `FlowNode`
- `FlowEdge`
- `NodeExecutor`
- `NodeExecutionContext`
- `NodeExecutionResult`
- `NodeRegistry`
- tipos de erro

Este pacote nao deve depender de frameworks, runtime server ou UI.

### Engine

`@flowmind/engine` interpreta e executa `FlowDefinition`.

Responsabilidades:

- validar estrutura minima do grafo;
- resolver ordem de execucao;
- chamar executores registrados;
- transportar dados entre nodes;
- produzir resultado rastreavel;
- cancelar ou interromper execucoes futuramente.

Nao responsabilidades:

- renderizar editor;
- chamar APIs HTTP de dashboard;
- conhecer React Flow;
- persistir banco de dados diretamente;
- conter implementacao concreta de nodes especificos.

API inicial esperada:

```ts
const engine = new Engine({ registry });

const result = await engine.execute(flow, {
  input,
  metadata,
});
```

### SDK

`@flowmind/sdk` e a fachada publica para consumidores externos.

Responsabilidades:

- criar engine com defaults seguros;
- registrar nodes oficiais;
- expor helpers para criar nodes;
- esconder detalhes internos que podem mudar.

### Editor Core

`@flowmind/editor-core` contem regras puras do editor:

- manipulacao de grafo;
- copiar e colar;
- desfazer e refazer;
- selecao;
- alinhamento;
- validacoes visuais;
- conversao entre modelo interno e modelo do React Flow.

Nao deve depender de DOM ou Next.js.

### Apps

`apps/editor` usa Next.js, React e React Flow.

`apps/api` usa Fastify e expoe endpoints para:

- salvar workflows;
- executar workflows;
- consultar execucoes;
- gerenciar credenciais futuramente;
- servir integracoes para apps externos.

`apps/docs` documenta SDK, nodes oficiais e exemplos.

## Modelo Interno Inicial

```ts
export type FlowDefinition = {
  id: string;
  name: string;
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type FlowNode = {
  id: string;
  type: string;
  position: NodePosition;
  inputs: NodePort[];
  outputs: NodePort[];
  data: Record<string, unknown>;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};
```

## Contrato De Node

```ts
export interface NodeExecutor {
  execute(context: NodeExecutionContext): Promise<NodeExecutionResult>;
}
```

Cada pacote `node-*` deve exportar:

- metadados do node;
- schema de configuracao;
- executor;
- opcionalmente componentes editoriais isolados.

## Registry

O registry e o ponto de extensao principal.

```ts
registry.register({
  type: "http.request",
  executor: httpRequestExecutor,
  metadata,
});
```

A engine depende do registry por interface. Isso permite nodes oficiais,
plugins locais e plugins externos no futuro.

## Decisoes Iniciais

1. A primeira implementacao tecnica sera criada dentro de `flowmind/`.
2. O bot atual nao sera migrado automaticamente nesta fase.
3. O bot atual passa a ser representado conceitualmente pelo agente `Universal`.
4. O agente `CSNF` nasce independente como companheiro de treino, mascote e coach.
5. O editor visual vira depois que os contratos de schema estiverem estaveis.
6. A integracao WhatsApp futura deve nascer como `packages/node-whatsapp`, nao
   como dependencia direta da engine.
7. O suporte a `node-code` deve ser tratado como recurso sensivel e isolado,
   com sandbox ou runner separado antes de uso em producao.

## Proxima Etapa Recomendada

Criar a base minima da pasta `flowmind/`:

- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `packages/shared`
- `packages/engine`

Esta etapa deve conter apenas tipos compartilhados, registry e uma engine capaz
de executar um fluxo linear simples com executores registrados.
