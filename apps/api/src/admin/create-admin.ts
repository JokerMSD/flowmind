import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";

import { resolveStoragePath } from "@flowmind/agent-memory";
import { JsonAccountRepository } from "@flowmind/auth-memory";

import { createPasswordHasher, normalizeEmail } from "./auth.js";

const environmentPath = resolve(process.cwd(), "../../.env");
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

const input = process.stdin;
const output = process.stdout;
const prompts = createInterface({ input, output });

try {
  const automated = readAutomatedInput(process.env);
  const name = (automated?.name ?? (await prompts.question("Nome: "))).trim();
  if (name.length < 2 || name.length > 100) throw new Error("Informe um nome valido.");
  const email = normalizeEmail(automated?.email ?? (await prompts.question("E-mail: ")));
  prompts.close();
  const password = automated?.password ?? (await readPassword("Senha (minimo 12 caracteres): "));

  const storagePath = join(resolveStoragePath(process.env), "auth");
  const accounts = new JsonAccountRepository(storagePath);
  if (await accounts.findByEmail(email)) throw new Error("Ja existe uma conta com este e-mail.");

  const now = new Date().toISOString();
  await accounts.save({
    id: randomUUID(),
    name,
    email,
    passwordHash: await createPasswordHasher().hash(password),
    role: "admin",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  output.write(`\nAdministrador criado: ${email}\n`);
} catch (error) {
  prompts.close();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readAutomatedInput(
  environment: NodeJS.ProcessEnv,
): { name: string; email: string; password: string } | undefined {
  const values = [
    environment.FLOWMIND_ADMIN_NAME,
    environment.FLOWMIND_ADMIN_EMAIL,
    environment.FLOWMIND_ADMIN_PASSWORD,
  ];
  if (values.every((value) => value === undefined)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error(
      "FLOWMIND_ADMIN_NAME, FLOWMIND_ADMIN_EMAIL e FLOWMIND_ADMIN_PASSWORD devem ser informados juntos.",
    );
  }
  return { name: values[0]!, email: values[1]!, password: values[2]! };
}

async function readPassword(question: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const fallback = createInterface({ input, output });
    const password = await fallback.question(question);
    fallback.close();
    return password;
  }
  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Operacao cancelada."));
        } else if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
        } else if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
        } else if (character >= " ") {
          value += character;
          output.write("*");
        }
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
    };
    input.on("data", onData);
  });
}
