import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const checks = [
  ["Node.js 20 ou superior", Number(process.versions.node.split(".")[0]) >= 20],
  ["FLOWMIND_ADMIN_TOKEN definido", Boolean(process.env.FLOWMIND_ADMIN_TOKEN)],
  ["WHATSAPP_WEB_AUTH_PATH definido", Boolean(process.env.WHATSAPP_WEB_AUTH_PATH)],
];

console.log("FlowMind - verificacao do canal WhatsApp Web\n");
for (const [label, passed] of checks) {
  console.log(`${passed ? "[ok]" : "[pendente]"} ${label}`);
}

console.log(`
Roteiro manual:
1. Execute: corepack pnpm whatsapp:start
2. Abra: http://localhost:3002/agents/whatsapp
3. Entre com FLOWMIND_ADMIN_TOKEN e clique em Conectar.
4. Escaneie o QR em WhatsApp > Dispositivos conectados.
5. Confirme que uma conversa nova aparece desabilitada.
6. Habilite a conversa e valide mensagens, pausa e modo manual.
7. Envie: "Me lembra todo dia as 08:00".
8. Reinicie a API e confirme a restauracao sem novo QR.
9. Use Logout no painel e confirme a remocao da sessao.

O teste real exige um telefone e nao e aprovado por este script automaticamente.
`);

if (!checks.every(([, passed]) => passed)) process.exitCode = 1;
