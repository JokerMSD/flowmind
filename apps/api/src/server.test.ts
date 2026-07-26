import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServer } from "./server.js";

test("agent chat persists a session and validates empty messages", async () => {
  await withServer(async (server) => {
    const agents = await server.inject({ method: "GET", url: "/agents" });
    assert.equal(agents.statusCode, 200);
    assert.equal(agents.json()[0].id, "csnf");

    const chat = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { agentId: "csnf", message: "Ola" },
    });
    assert.equal(chat.statusCode, 200);
    assert.match(chat.json().message.content, /shape/);

    const session = await server.inject({ method: "GET", url: `/sessions/${chat.json().sessionId}` });
    assert.equal(session.json().messages.length, 2);

    const invalid = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { agentId: "csnf", message: "   " },
    });
    assert.equal(invalid.statusCode, 400);
  });
});

test("agent routes reject invalid client input before reaching the domain", async () => {
  await withServer(async (server) => {
    const cases = [
      { method: "GET", url: "/agents/%20" },
      { method: "GET", url: "/sessions/%20" },
      { method: "POST", url: "/chat", payload: [] },
      { method: "GET", url: "/reminders?agentId=%20" },
      { method: "GET", url: "/reminders/%20" },
      { method: "PATCH", url: "/reminders/example/status", payload: { enabled: "false" } },
      { method: "GET", url: "/reminder-occurrences?status=unknown" },
      { method: "GET", url: "/reminder-occurrences?after=not-a-date" },
      { method: "GET", url: "/reminder-occurrences?agentId=%20" },
    ] as const;

    for (const request of cases) {
      const response = await server.inject(request);
      assert.ok(response.statusCode === 400 || response.statusCode === 422, `${request.method} ${request.url}`);
    }

    const malformedJson = await server.inject({
      method: "POST", url: "/chat", payload: "{", headers: { "content-type": "application/json" },
    });
    assert.equal(malformedJson.statusCode, 400);
  });
});

test("workflow execution rejects invalid payloads as client errors", async () => {
  await withServer(async (server) => {
    for (const payload of [{}, { id: "flow", name: "Flow", version: "1", nodes: [], edges: [] }]) {
      const response = await server.inject({ method: "POST", url: "/api/execute", payload });
      assert.ok(response.statusCode === 400 || response.statusCode === 422);
    }
  });
});

test("reminder API creates, normalizes, updates status, and deletes", async () => {
  await withServer(async (server) => {
    const payload = {
      agentId: "csnf",
      type: "shape-photo",
      message: " Foto do shape ",
      schedule: {
        daysOfWeek: [5, 1, 1],
        times: ["20:00", "08:00", "08:00"],
        timezone: "America/Sao_Paulo",
      },
      enabled: true,
    };
    const created = await server.inject({ method: "POST", url: "/reminders", payload });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().schedule.daysOfWeek, [1, 5]);
    assert.deepEqual(created.json().schedule.times, ["08:00", "20:00"]);
    const id = created.json().id as string;

    const paused = await server.inject({
      method: "PATCH",
      url: `/reminders/${id}/status`,
      payload: { enabled: false },
    });
    assert.equal(paused.json().enabled, false);

    const listed = await server.inject({ method: "GET", url: "/reminders?agentId=csnf" });
    assert.equal(listed.json().length, 1);

    const removed = await server.inject({ method: "DELETE", url: `/reminders/${id}` });
    assert.deepEqual(removed.json(), { deleted: true });
    const missing = await server.inject({ method: "GET", url: `/reminders/${id}` });
    assert.equal(missing.statusCode, 404);
  });
});

test("reminder API rejects invalid payloads and timezones", async () => {
  await withServer(async (server) => {
    const invalidPayload = await server.inject({
      method: "POST",
      url: "/reminders",
      payload: { agentId: "csnf", type: "shape-photo", message: "Foto", enabled: true, schedule: [] },
    });
    assert.equal(invalidPayload.statusCode, 400);

    const invalidTimezone = await server.inject({
      method: "POST",
      url: "/reminders",
      payload: {
        agentId: "csnf", type: "shape-photo", message: "Foto", enabled: true,
        schedule: { daysOfWeek: [1], times: ["08:00"], timezone: "Invalid/Timezone" },
      },
    });
    assert.equal(invalidTimezone.statusCode, 400);
  });
});

async function withServer(run: (server: ReturnType<typeof createServer>) => Promise<void>): Promise<void> {
  const storagePath = await mkdtemp(join(tmpdir(), "flowmind-api-"));
  const server = createServer({
    FLOWMIND_STORAGE_PATH: storagePath,
    FLOWMIND_SCHEDULER_INTERVAL_MS: "60000",
    FLOWMIND_REMINDER_RECOVERY_MINUTES: "1",
  });
  try {
    await server.ready();
    await run(server);
  } finally {
    await server.close();
    await rm(storagePath, { force: true, recursive: true });
  }
}
