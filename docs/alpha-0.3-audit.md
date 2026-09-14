# Alpha 0.3 - Auditoria e validacao

## Escopo

Esta auditoria cobre apenas a estabilizacao das entregas existentes da Alpha
0.3: contas administrativas, canal WhatsApp Web, inbox e historico, midias,
CSNF, Ollama local, lembretes, persistencia JSON e scripts locais.

## Classificacao do diff

### A - Produto e integracoes

- `apps/api/src/agents/*`
- `apps/api/src/whatsapp/*`
- `packages/agent-runtime/src/*`
- `packages/channel-core/src/repositories.ts`
- `packages/channel-memory/src/*`
- `packages/channel-runtime/src/*`
- `packages/whatsapp-web/src/*`

### B - Interface

- `apps/agents/app/agents/whatsapp/whatsapp.css`
- `apps/agents/src/agents-workspace.tsx`
- `apps/agents/src/components/chat-panel.tsx`
- `apps/agents/src/hooks/use-agents-workspace.ts`
- `apps/agents/src/types.ts`
- `apps/agents/src/whatsapp/*`

### C - Testes

- `apps/api/src/server.test.ts`
- `packages/agent-runtime/src/runtime.test.ts`
- `packages/channel-runtime/src/runtime.test.ts`
- `packages/whatsapp-web/src/provider.test.ts`
- `packages/whatsapp-web/src/chat-index-repository.test.ts`

### D - Configuracao e operacao

- `.env.example`
- `scripts/local-process.mjs`

### E - Documentacao

- `README.md`
- `docs/alpha-0.3-audit.md`

## Decisoes de estabilizacao

- O indice de chats usa escrita serializada, arquivo temporario exclusivo e
  publicacao por `rename`.
- Arquivo de indice ausente inicia vazio; arquivo invalido gera erro explicito e
  nao e sobrescrito.
- A descoberta da versao do Baileys tem limite de cinco segundos e usa a versao
  embarcada quando a consulta externa falha.
- Antes de enviar uma resposta automatica, o processador recarrega a conversa.
  Mudanca simultanea para modo manual, pausado, bloqueado ou desativado impede o
  envio e nao e sobrescrita.
- O Ollama tem timeout configuravel e fallback deterministico para erro HTTP,
  resposta vazia ou indisponibilidade local.
- Rotas de agentes, sessoes, lembretes e WhatsApp exigem sessao administrativa.
- A retencao configurada e aplicada a mensagens e registros externos.
- Logout do WhatsApp remove dados locais de conversas antes de permitir um novo
  pareamento no mesmo identificador.

## Dados sensiveis

O repositorio nao deve conter `.env`, credenciais do WhatsApp, storage local,
cookies, senhas ou tokens de sessao. Esses caminhos permanecem ignorados pelo
Git. Senhas usam `scrypt` com salt individual; o cookie contem apenas um token
opaco e o storage persiste somente seu hash.

## Validacao manual

O teste automatizado nao substitui a validacao com telefone real. Antes de
aprovar a sprint para uso real, executar e registrar cada cenario
individualmente:

| Cenario | Status | Evidencia | Observacao |
| --- | --- | --- | --- |
| Geracao e leitura do QR Code em telefone real | PASS | Confirmacao direta do usuario | Nao repetir o pareamento inicial nem encerrar a sessao existente |
| Pareamento inicial | PASS | Confirmacao direta do usuario | Sessao real atualmente conectada deve ser preservada |
| Estado conectado no painel | PASS | Confirmacao direta do usuario em painel local | Indicador conectado observado sem novo QR ou pareamento |
| Envio real pelo FlowMind | PASS | Envio confirmado em conversa privada controlada, com entrega unica no telefone real | Saida refletida no painel sem duplicidade, erro ou resposta automatica |
| Recebimento real no FlowMind | PASS | Mensagem externa recebida no painel em conversa privada controlada | Confirmacao direta do usuario, sem duplicidade |
| Atualizacao e ordenacao da inbox | PASS | Preview, horario, contador e posicao atualizados apos nova atividade | Confirmacao direta do usuario, sem conversa paralela |
| Persistencia apos reinicio | PENDENTE | A registrar | Reiniciar apenas os processos, preservando a autenticacao |
| Resposta do CSNF | PENDENTE | A registrar | Validar em conversa habilitada |
| Continuidade sem nova mencao | PENDENTE | A registrar | Validar dentro do contexto ativo |
| Handoff humano/agente | PENDENTE | A registrar | Confirmar que o agente respeita a intervencao humana |
| Modo `disabled` | PENDENTE | A registrar | Validar ausencia de resposta automatica |
| Modo `enabled` | PENDENTE | A registrar | Validar resposta automatica |
| Modo `paused` | PENDENTE | A registrar | Validar pausa temporaria |
| Modo `manual` | PENDENTE | A registrar | Validar atendimento exclusivamente humano |
| Modo `blocked` | PENDENTE | A registrar | Validar bloqueio de envio |
| Protecao contra loops | PENDENTE | Mensagem manual propria nao provocou resposta automatica ou duplicidade | Evidencia basica obtida; aprovacao depende dos testes posteriores de CSNF e modos |
| Ollama e fallback | PENDENTE | A registrar | Validar resposta local e indisponibilidade controlada |
| Midias | PENDENTE | A registrar | Validar recebimento e exibicao dos tipos suportados |
| Historico | PENDENTE | A registrar | Buscar uma vez e acompanhar o progresso |
| Lembrete real | PENDENTE | A registrar | Enviar para contato selecionado |
| Apresentacao enviada apenas uma vez | PENDENTE | A registrar | Confirmar primeira interacao e ausencia de repeticao |
| Logout e novo pareamento | NAO AUTORIZADO | Nao executado | Teste destrutivo, separado e dependente de autorizacao explicita |

Resultados nao executados com telefone real devem ser declarados como pendentes,
nunca inferidos a partir dos testes automatizados.

Durante esta validacao, a sessao WhatsApp conectada deve ser preservada. Nao
executar logout, purga de autenticacao, encerramento de sessao ou novo
pareamento sem autorizacao explicita.

## Resultado consolidado da validacao manual

```text
QR Code em telefone real: PASS
Pareamento inicial: PASS
Demais fluxos ponta a ponta: conforme matriz individual
```

A Alpha 0.3 somente pode ser aprovada depois da validacao dos fluxos essenciais
de envio, recebimento, agente, persistencia e lembrete.

## Incidentes encontrados na validacao

### Remocao automatica de autenticacao apos erro de stream

- Resultado manual: `FAIL`.
- Impacto: recebimento e atualizacao da inbox ficaram bloqueados.
- Causa: falhas classificadas como autenticacao terminal chamavam a mesma
  remocao de credenciais reservada ao logout explicito.
- Correcao: somente logout solicitado explicitamente remove autenticacao;
  erros de stream `forbidden` usam reconexao limitada e demais falhas terminais
  preservam as credenciais.
- Regressao: provider valida reconexao de `Stream Errored (ack)` sem apagar o
  estado e preservacao do estado em logout remoto ou falha terminal.
- Estado da sessao afetada: autenticacao ja removida pelo comportamento anterior;
  nenhum novo QR ou pareamento foi iniciado.
