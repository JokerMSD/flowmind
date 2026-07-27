# WhatsApp Web Channel - Alpha 0.3

## Status e escopo

O WhatsApp Web Channel e um canal experimental e nao oficial para testes
controlados. Ele usa Baileys `6.7.23` e a sessao de WhatsApp Web, sem ser a
WhatsApp Cloud API oficial. Nao afirmar que este canal e suportado pela Meta,
nem usa-lo como canal de massa ou como base de uma operacao de producao.

Riscos conhecidos: desconexoes, mudancas no protocolo, revogacao de sessao,
restricao ou banimento da conta, perda do dispositivo pareado e mensagens nao
entregues. O uso deve ser opt-in, com baixo volume, contatos esperados e
respeito aos termos aplicaveis. Nao automatize spam, disparos em massa,
assediamento, contorno de bloqueios ou campanhas nao solicitadas.

Premissas do Alpha:

- filesystem persistente para guardar a autenticacao; filesystem efemero pode
  perder a sessao a cada reinicio;
- uma unica instancia ativa por `connectionId` e por credencial;
- backup protegido e acesso administrativo restrito;
- o canal e um adaptador substituivel, nao uma dependencia da engine;
- nao iniciar o cliente WhatsApp apenas para validar a UI.

## Setup

1. Use Node.js e o gerenciador de pacotes ja adotados pelo repositorio.
2. Instale as dependencias do projeto conforme o setup existente. O pacote do
   canal deve permanecer fixado em Baileys `6.7.23`.
3. Garanta um volume persistente, exclusivo para a sessao, fora de repositorios
   publicos e fora de logs.
4. Configure o ambiente sem commitar segredos. Variaveis esperadas (os nomes
   finais devem seguir o runtime que consumir este contrato):

```env
WHATSAPP_WEB_ENABLED=false
WHATSAPP_WEB_CONNECTION_ID=whatsapp-personal
WHATSAPP_WEB_AUTH_PATH=./whatsapp-auth
FLOWMIND_ADMIN_SESSION_TTL_MINUTES=480
```

`WHATSAPP_WEB_ENABLED` deve continuar `false` ate a validacao administrativa.
Crie o primeiro administrador com `npm run admin:create`. Nao existe cadastro
publico; senhas, cookies e material de autenticacao do WhatsApp nao devem
aparecer em logs ou mensagens.

## Login administrativo e QR

O pareamento e uma operacao administrativa. Proteja o endpoint e o painel com
autenticacao, limite tentativas e registre apenas eventos sem dados sensiveis.

1. Inicie o painel/API com a funcionalidade habilitada.
2. Entre como administrador.
3. Crie ou selecione o `connectionId` correto.
4. Solicite o QR no painel e escaneie-o em **WhatsApp > Dispositivos
   conectados > Conectar dispositivo**.
5. Confirme o estado conectado no painel antes de enviar qualquer mensagem.

O QR nao deve ser impresso no terminal nem exposto em URL, log, captura publica
ou endpoint sem protecao. Remova o dispositivo pelo proprio WhatsApp quando o
ambiente for descartado ou a conta deixar de ser usada.

## Protecao de autenticacao e persistencia

Trate o diretorio de auth como segredo operacional: permissao minima, volume
persistente criptografado quando possivel, acesso somente ao processo e backup
com criptografia. Nunca copie auth para issue, chat, artefato de CI ou controle
de versao. Nao rode duas instancias com o mesmo diretorio ou `connectionId`.

O backup deve ser manual, versionado por data e testado em ambiente isolado.
Ao revogar uma sessao, invalide tambem seus backups operacionais e remova
arquivos temporarios. Se houver suspeita de vazamento, despareie o dispositivo,
troque credenciais administrativas e investigue os logs.

## Start, painel e modos

Use o start definido pelo projeto e confirme no painel: conexao, ultima
atividade, erro atual, QR pendente e `connectionId`. O painel deve permitir
parar/reconectar uma conexao, ver o estado amigavel e iniciar login; nao deve
exibir hashes, cookies ou material bruto de autenticacao.

Modos do Alpha:

- `manual`: envio e acoes somente apos comando administrativo;
- `reminders`: lembretes opt-in, com agenda e destinatarios previamente
  autorizados, limites baixos e possibilidade de cancelamento;
- `disabled`: nenhuma conexao ou mensagem e iniciada.

Comece em `manual`. O modo de reminders nao e um mecanismo de massa e deve
falhar fechado quando nao houver consentimento, destino valido ou limite claro.

## Reminders

Antes de agendar, confirme destinatario, texto, fuso, horario, frequencia,
consentimento e forma de cancelamento. Registre o minimo necessario para
operar e auditar. Evite conteudo sensivel. Um lembrete cancelado nao deve ser
reenfileirado por uma reconexao.

## Troubleshooting

### QR nao aparece

Confirme `WHATSAPP_ENABLED`, permissao de escrita no auth dir, estado da
conexao no painel e se ja existe uma sessao valida. Gere um novo QR pelo painel
e nao reutilize um QR expirado.

### Desconectou ou fica reconectando

Verifique o motivo e o horario no painel, a rede e a existencia de instancia
duplicada. Use backoff, pare a instancia duplicada e tente uma reconexao
administrativa. Nao apague auth automaticamente: isso pode destruir uma sessao
recuperavel.

### Restricao, logout ou falha de autenticacao

Pare os envios, preserve os eventos de diagnostico sem dados pessoais, confira
os dispositivos conectados no telefone e faca logout/repareamento somente com
autorizacao. Nao tente contornar bloqueios nem aumentar volume para "testar".

### Mensagem nao entregue

Confirme o estado da conexao e o identificador do destinatario. Nao repita
indefinidamente: use idempotencia, limite de tentativas e fila cancelavel.

## Reconnect, logout e ciclo de vida

Reconexao deve ser controlada por `connectionId`, com backoff e limite. Ao
encerrar, aguarde a fila segura, marque o estado como offline e feche a
instancia. Logout e uma acao explicita no painel ou no telefone; depois dele,
remova apenas os dados de auth que a politica aprovar e exija novo QR.

## Privacidade e retencao

Colete somente o necessario para entregar o fluxo. Minimize telefone, nome,
texto, timestamps e identificadores; restrinja acesso por funcao e proteja em
transito e repouso. Defina retencao por finalidade: logs tecnicos curtos,
mensagens somente pelo tempo operacional/contratual e auth enquanto a conexao
estiver autorizada. Atenda exclusao, revogacao e solicitacoes de acesso de
acordo com a politica aplicavel. Nao use dados do canal para treinamento sem
base legal e autorizacao adequada.

## Contrato JSON de referencia

O formato abaixo e ilustrativo e nao significa que a implementacao ja esteja
disponivel:

```json
{
  "channel": "whatsapp-web-experimental",
  "alpha": "0.3",
  "provider": "baileys",
  "providerVersion": "6.7.23",
  "connectionId": "default",
  "mode": "manual",
  "enabled": false,
  "auth": { "storage": "persistent-filesystem", "adminOnly": true },
  "policy": {
    "massMessaging": false,
    "production": false,
    "optInRequired": true,
    "singleInstance": true
  },
  "retention": { "messagesDays": 7, "logsDays": 30 }
}
```

## Roteiro `whatsapp:verify`

O roteiro deve ser real, reproduzivel e honesto: ele pode validar configuracao,
filesystem, isolamento de `connectionId`, protecao administrativa, estado do
painel, pareamento manual autorizado e uma mensagem de teste para um destino
opt-in. Ele nao deve alegar entrega, estabilidade, suporte oficial ou aptidao
para producao sem evidencia.

Critérios de aceite:

- Baileys resolve exatamente `6.7.23`;
- auth dir existe, e persistente e nao esta versionado;
- uma segunda instancia da mesma conexao e recusada;
- QR aparece somente para administrador e nao no terminal;
- conectar, desconectar, reconectar e logout atualizam estados observaveis;
- mensagem de teste opt-in tem resultado, idempotencia e erro verificaveis;
- modo `disabled` nao inicia cliente e mode `manual` nao dispara sozinho;
- falhas e restricoes sao reportadas como inconclusivas, nunca como sucesso.

Se o roteiro nao puder executar login ou envio sem efeitos externos, ele deve
parar nessa etapa e reportar `not_run` com o motivo. O runtime WhatsApp nao e
iniciado por validacoes de documentacao ou UI.

## Evolucao para WhatsApp Cloud API

Cloud API e a recomendacao comercial para uma operacao sustentavel, com canal
oficial, governanca e escalabilidade adequadas. Esta evolucao e planejada; a
Cloud API **nao esta implementada** neste Alpha.

Passos do adendo:

1. Definir um contrato de canal independente do provedor, mantendo eventos,
   mensagens, status, erros e idempotencia.
2. Criar credenciais e configuracao por `connectionId`, sem compartilhar auth
   do WhatsApp Web com Cloud.
3. Implementar o webhook de entrada e a verificacao de assinatura da Meta.
4. Implementar envio Cloud com templates, opt-in, limites e tratamento de
   status/erros.
5. Adicionar observabilidade, retencao, auditoria, testes de homologacao e
   estrategia de migracao/coexistencia.
6. Migrar gradualmente trafego comercial para Cloud, mantendo rollback e
   desligamento explicito do canal experimental.

Web e Cloud podem coexistir por `connectionId`: cada conexao deve declarar seu
`provider` e ter credencial, fila, estado e politicas separados. Coexistencia
nao autoriza duas instancias Web na mesma conta nem roteamento ambiguo.
