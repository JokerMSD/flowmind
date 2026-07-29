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
aprovar a sprint para uso real, executar e registrar:

1. Criar conta administrativa e autenticar.
2. Gerar QR, parear um telefone e confirmar estado conectado.
3. Receber e enviar mensagens em conversa privada.
4. Confirmar atualizacao imediata, ordem da inbox, nomes, fotos e midias.
5. Buscar historico uma vez e acompanhar progresso ate conclusao ou pausa.
6. Alternar automacao, atendimento manual e pausa durante uma resposta.
7. Enviar lembrete para contatos selecionados e verificar introducao unica.
8. Reiniciar API e confirmar restauracao de sessao, chats e configuracoes.
9. Encerrar a sessao e gerar um novo QR.

Resultados nao executados com telefone real devem ser declarados como pendentes,
nunca inferidos a partir dos testes automatizados.
