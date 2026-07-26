# FlowMind

FlowMind e uma plataforma leve e modular para automacao de workflows com IA.

## Visao Do Produto

O FlowMind e construido usando o proprio FlowMind.

O editor deve ser rapido, simples e fluido o suficiente para que qualquer pessoa
crie um primeiro workflow local em menos de 5 minutos.

O primeiro agente oficial e o CSNF. No Alpha 0.2 ele conversa por um provider
fake deterministico e gerencia lembretes de foto do shape com persistencia JSON.
IA real, WhatsApp e outros canais externos ainda nao fazem parte do produto.

Nesta etapa, o produto ja possui um primeiro workflow funcional local:

```text
Start -> Text -> Console
```

Ao executar o workflow padrao, o resultado esperado no Console Visual e:

```text
Olá FlowMind
```

## Como Executar

### Git Bash no Visual Studio Code

Na primeira execucao:

```bash
npm run setup
```

Depois, inicie API, Editor e Agentes juntos:

```bash
npm run start
```

Use `Ctrl+C` para encerrar os servicos. Acesse:

```text
Editor:  http://localhost:3000
API:     http://localhost:3001
Agentes: http://localhost:3002/agents
```

Para validar tipos e builds:

```bash
npm run check
```

Esses comandos nao executam `corepack enable` e, portanto, nao precisam gravar
em `C:\Program Files\nodejs` nem solicitar permissao de administrador.

## Alpha 0.2 - CSNF

A pagina `/agents` carrega o CSNF pela API, restaura a sessao salva no navegador
e oferece chat, CRUD de lembretes e historico de disparos. A entrega de
lembretes nesta sprint e interna ao app.

Variaveis disponiveis em `.env.example`:

```text
FLOWMIND_STORAGE_PATH=./storage
FLOWMIND_SCHEDULER_INTERVAL_MS=30000
FLOWMIND_REMINDER_RECOVERY_MINUTES=10
NEXT_PUBLIC_FLOWMIND_API_URL=http://localhost:3001
```

A API cria automaticamente `agents.json`, `sessions.json`, `reminders.json` e
`reminder-occurrences.json` no diretorio configurado. Escritas concorrentes sao
serializadas e publicadas com arquivo temporario seguido de `rename`.

### Endpoints

```text
GET    /agents
GET    /agents/:agentId
POST   /chat
GET    /sessions/:sessionId
GET    /reminders
GET    /reminders/:id
POST   /reminders
PUT    /reminders/:id
DELETE /reminders/:id
PATCH  /reminders/:id/status
GET    /reminder-occurrences
```

O `PUT` substitui todos os campos editaveis. Lembretes aceitam filtro `agentId`;
ocorrencias aceitam `agentId`, `status` e `after`.

Payload de chat:

```json
{
  "agentId": "csnf",
  "message": "Preciso treinar"
}
```

Payload de lembrete:

```json
{
  "agentId": "csnf",
  "type": "shape-photo",
  "message": "Hora da foto do shape!",
  "schedule": {
    "daysOfWeek": [1, 3, 5],
    "times": ["08:00", "20:00"],
    "timezone": "America/Sao_Paulo"
  },
  "enabled": true
}
```

### Scheduler

O intervalo padrao e 30 segundos. Ao iniciar, o scheduler recupera somente os
ultimos 10 minutos, minuto a minuto. A chave logica
`reminderId + scheduledFor` impede disparos duplicados apos reinicio.

Os testes usam `FixedClock`, portanto o scheduler pode ser validado sem esperar:

```bash
npm test
```

Para validar manualmente, crie na pagina um lembrete para o dia e minuto atuais
em `America/Sao_Paulo`. O disparo aparece na interface em ate dois ciclos de
30 segundos.

### Comandos manuais

Instale as dependencias:

```bash
corepack pnpm install
```

Inicie a API:

```bash
corepack pnpm dev:api
```

Em outro terminal, inicie o editor:

```bash
corepack pnpm dev:editor
```

Acesse:

```text
http://localhost:3000
```

A API roda por padrao em:

```text
http://localhost:3001
```

## O Que Ja Funciona

- abrir o editor local;
- ver um workflow padrao;
- adicionar nodes pela sidebar;
- adicionar nodes com duplo clique no canvas;
- mover nodes no canvas;
- conectar nodes;
- selecionar nodes;
- deletar, duplicar, copiar, colar e selecionar tudo por atalhos;
- usar Command Palette com `Ctrl+K`;
- editar a mensagem do node `Text`;
- salvar automaticamente no navegador;
- restaurar automaticamente o ultimo workflow salvo;
- salvar e carregar JSON manualmente;
- executar o workflow pela API;
- visualizar resultado, node atual, tempo, payloads, status e logs no painel inferior;
- ver avisos de validacao em tempo real sem bloquear a edicao.

## Atalhos

```text
Ctrl+K  Command Palette
Ctrl+S  Salvar manualmente
Ctrl+Z  Undo
Ctrl+Y  Redo
Ctrl+C  Copiar selecao
Ctrl+V  Colar
Ctrl+D  Duplicar selecao
Ctrl+A  Selecionar tudo
Delete  Remover selecao
```

## Estrutura Principal

```text
flowmind/
  apps/
    editor/
    api/
    docs/
    agents/
  packages/
    schema/
    engine/
    node-core/
    editor-core/
    assistant-core/
    shared/
    sdk/
    ui/
    agent-core/
    agent-runtime/
    agent-memory/
    agent-personality/
```

## Fluxo De Execucao

1. O editor monta um `Workflow` usando os tipos de `@flowmind/schema`.
2. O usuario clica em `Executar`.
3. O editor envia o JSON para `POST /api/execute`.
4. A API cria um `DefaultNodeRegistry`.
5. `@flowmind/node-core` registra `Start`, `Text` e `Console`.
6. `Engine.execute()` percorre o fluxo sequencialmente.
7. Cada node retorna um `NodeResult`.
8. A API devolve `WorkflowExecutionResult`.
9. O editor mostra resultado e logs no Console Visual.

Durante a execucao, o editor destaca nodes executados, anima conexoes do caminho
executado e mostra o tempo abaixo de cada node.

## AutoSave E Undo/Redo

O editor serializa o workflow atual em `localStorage` a cada alteracao relevante
de grafo. Ao abrir novamente, o ultimo workflow salvo e restaurado
automaticamente.

Undo/Redo usa snapshots locais de nodes e edges. O historico e limitado para
evitar crescimento indefinido e nao inclui efeitos visuais temporarios de
execucao.

## Como Criar Um Novo Node

1. Defina o tipo do node em `packages/node-core/src/constants.ts`.
2. Crie um executor que implemente `NodeExecutor`.
3. Registre o executor em `registerCoreNodes`.
4. Adicione a definicao visual em `packages/editor-core/src/node-catalog.ts`.
5. Se o node precisar de configuracao, adicione o campo no Inspector do editor.

Nenhum node deve ser resolvido com `switch(type)` dentro da engine. A resolucao
deve continuar passando pelo `NodeRegistry`.

## Assistentes

`@flowmind/assistant-core` define os contratos para um futuro assistente visual:

- `Assistant`
- `AssistantEvent`
- `AssistantPanel`
- `AssistantSuggestion`
- `AssistantAction`
- `AssistantContext`
- `AssistantProvider`

O CSNF devera usar esses contratos futuramente para sugerir acoes, explicar
erros, propor nodes e acompanhar a criacao de workflows sem acoplar IA ao editor.

## Placeholders De Documentacao Visual

Screenshots e GIFs serao adicionados futuramente:

```text
docs/assets/editor-default-workflow.png
docs/assets/editor-alpha-command-palette.gif
docs/assets/execute-workflow.gif
docs/assets/inspector-text-node.png
```

## Limitacoes Atuais

- apenas fluxo sequencial;
- sem loops;
- sem `If`, `Switch` ou `Delay`;
- sem IA;
- sem WhatsApp;
- sem banco de dados;
- sem plugins externos;
- sem auto layout;
- sem validacao visual completa de grafo;
- persistencia apenas em `localStorage` pelo editor.

## Preparado Para Crescer

A implementacao atual mantem separacao entre:

- `schema`: contratos oficiais;
- `engine`: execucao;
- `node-core`: nodes oficiais basicos;
- `editor-core`: modelo inicial e catalogo do editor;
- `apps/api`: transporte HTTP;
- `apps/editor`: interface visual.

Essa separacao preserva o caminho para plugins, agentes, IA, WhatsApp, banco e
runtime distribuido sem acoplar a engine ao editor.
