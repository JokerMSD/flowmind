# FlowMind

FlowMind e uma plataforma leve e modular para automacao de workflows com IA.

## Visao Do Produto

O FlowMind e construido usando o proprio FlowMind.

O editor deve ser rapido, simples e fluido o suficiente para que qualquer pessoa
crie um primeiro workflow local em menos de 5 minutos.

O primeiro agente oficial e o CSNF. Ele gerencia lembretes de foto do shape,
conversa pelo WhatsApp e pode usar um modelo local via Ollama. O provider fake
deterministico continua disponivel para testes e ambientes sem IA local.

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

## Alpha 0.3 - CSNF e WhatsApp

A pagina `/agents` carrega o CSNF pela API, restaura a sessao salva no navegador
e oferece chat, CRUD de lembretes e historico de disparos. A pagina
`/agents/whatsapp` fornece inbox, contatos, historico, midias, controle de
automacao por conversa e conexao por QR code.

Variaveis disponiveis em `.env.example`:

```text
FLOWMIND_STORAGE_PATH=./storage
FLOWMIND_SCHEDULER_INTERVAL_MS=30000
FLOWMIND_REMINDER_RECOVERY_MINUTES=10
FLOWMIND_AI_PROVIDER=fake
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e2b-it-qat
OLLAMA_TIMEOUT_MS=120000
NEXT_PUBLIC_FLOWMIND_API_URL=http://localhost:3001
```

Para desenvolvimento local, copie `.env.example` para `.env` e crie o primeiro
administrador com `npm run admin:create`. Os comandos `npm run start`,
`npm run whatsapp:start` e `npm run whatsapp:verify` carregam o `.env`
automaticamente. O `.env`, o storage, as contas e as credenciais do WhatsApp
sao ignorados pelo Git.

Para habilitar o canal local:

```text
WHATSAPP_WEB_ENABLED=true
```

O provider padrao continua sendo o Baileys. Para testar o provider alternativo
baseado em `whatsapp-web.js`, configure:

```text
WHATSAPP_PROVIDER=webjs
WHATSAPP_WEBJS_AUTH_PATH=./whatsapp-webjs-auth
WHATSAPP_WEBJS_HEADLESS=true
```

Ao trocar o provider, o FlowMind preserva os dados locais, desativa a conexao
anterior e exige um novo clique em Conectar. Apenas um provider e registrado por
processo. Para voltar sem alterar codigo, use `WHATSAPP_PROVIDER=baileys`.

O `whatsapp-web.js` usa Chromium/Puppeteer e oferece uma fonte mais completa de
chats, contatos, historico e midias do WhatsApp Web. Em contrapartida, consome
mais memoria que o Baileys e continua sendo uma integracao nao oficial, sujeita
a mudancas do WhatsApp e bloqueio da conta. Para producao com garantia oficial,
o caminho recomendado continua sendo a WhatsApp Cloud API.

Depois execute `npm run start`, entre em `http://localhost:3002/agents`, faca
login e abra o canal WhatsApp. O botao de conexao exibe o QR code na interface;
credenciais e dados de sessao permanecem somente no caminho configurado por
`WHATSAPP_WEB_AUTH_PATH` ou `WHATSAPP_WEBJS_AUTH_PATH`.

### IA local com Ollama

Instale o Ollama no Windows e baixe o modelo:

```bash
winget install --id Ollama.Ollama -e
ollama pull gemma4:e2b-it-qat
```

No `.env`, altere `FLOWMIND_AI_PROVIDER` para `ollama`. O CSNF passa a responder
automaticamente apenas quando seu nome e mencionado, por exemplo:

```text
CSNF, como posso organizar meu treino hoje?
```

O modelo roda na maquina local e nao exige chave de API. A primeira resposta
pode ser mais lenta enquanto o modelo e carregado na memoria. Se o Ollama ficar
indisponivel, o provider fake fornece uma resposta de contingencia sem
interromper o canal.

O painel administrativo usa e-mail e senha. Senhas sao derivadas com `scrypt`
e salt individual; sessoes opacas ficam em cookie HTTP-only e podem ser
revogadas no logout. Nao existe cadastro publico.

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

## Por Que Alpha 0.3 Usa JSON

O armazenamento JSON mantém a execução local simples, inspecionável e sem
serviços externos durante a validação dos contratos de agentes, sessões,
lembretes e ocorrências. Ele é adequado para desenvolvimento e demonstrações em
um único processo, mas não é tratado como banco de dados de produção.

Uma migração futura para SQLite deve preservar as interfaces de repositório de
`@flowmind/agent-core` e `@flowmind/channel-core`, substituindo apenas os
adapters de memória. A migração deverá usar transações para operações compostas,
índices para consultas e restrições únicas para chaves idempotentes. Os dados
JSON existentes poderão ser importados sem alterar runtimes ou rotas HTTP.

## Limitacoes Conhecidas

- o armazenamento JSON suporta somente uma instancia do processo;
- filesystems efemeros podem perder todos os dados locais em reinicios ou
  redeploys;
- o scheduler e local e nao coordena execucao entre instancias;
- nao existe retentativa automatica de entrega;
- ocorrencias `pending` ha 10 minutos ou mais sao convertidas para `failed`
  durante a recuperacao, sem nova tentativa de entrega;
- nao existe suporte oficial ou garantia de disparo para transicoes de horario
  de verao;
- SQLite e a migracao planejada para persistencia local transacional;
- a fila de mensagens e limitada; saturacao e reportada pelo callback do
  runtime, mas nao existe persistencia ou retry da fila;
- o fallback do Ollama mantem o canal disponivel, mas nao identifica respostas
  degradadas na interface;
- introducoes, lembretes e iniciativas automaticas ainda nao compartilham uma
  transacao unica;
- WhatsApp Web usa um protocolo nao oficial e pode sofrer alteracoes externas;
- o indice de chats e local, pertence a uma unica instancia e uma corrupcao
  interrompe a carga com erro explicito para preservar o arquivo original;
- o runtime nao possui lock distribuido; nunca execute duas instancias com o
  mesmo diretorio de autenticacao;
- o logout do WhatsApp remove conversas e mensagens locais para impedir que uma
  nova conta pareada herde dados da conta anterior;

Sessões usam controle otimista por `updatedAt` e pelo ID da ultima mensagem. Em
um conflito local simples, o runtime recarrega a versão persistida, combina as
mensagens ainda ausentes e tenta salvar uma vez sobre a versão mais recente.
Isso reduz sobrescritas entre abas no mesmo processo, mas não substitui
transações nem coordenação distribuída.

- apenas fluxo sequencial;
- sem loops;
- sem `If`, `Switch` ou `Delay`;
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
