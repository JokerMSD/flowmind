import { csnfAgent } from "@flowmind/agent-core";
import type { AgentRepository, StoredAgent } from "./types.js";

export const csnfSeed: StoredAgent = csnfAgent;

export async function seedCsnf(repository: AgentRepository): Promise<StoredAgent> {
  const existing = await repository.findById(csnfSeed.id);
  if (existing !== undefined) return existing;
  await repository.save(csnfSeed);
  return csnfSeed;
}
