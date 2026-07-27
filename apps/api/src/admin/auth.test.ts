import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonAccountRepository } from "@flowmind/auth-memory";
import Fastify from "fastify";

import { createPasswordHasher } from "./auth.js";
import { createAdminAuthHook, registerAdminAuthRoutes } from "./index.js";

test("account login issues an HttpOnly session and logout revokes it", async () => {
  const storagePath = await mkdtemp(join(tmpdir(), "flowmind-auth-"));
  const accounts = new JsonAccountRepository(join(storagePath, "auth"));
  const now = new Date().toISOString();
  await accounts.save({
    id: "account-1",
    name: "Administrador",
    email: "admin@flowmind.local",
    passwordHash: await createPasswordHasher().hash("correct-password"),
    role: "admin",
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  const server = Fastify();
  const auth = registerAdminAuthRoutes(server, { storagePath, ttlMs: 60_000 });
  server.get("/admin/private", { onRequest: createAdminAuthHook(auth) }, async () => ({
    ok: true,
  }));
  await server.ready();

  try {
    assert.equal((await server.inject({ method: "GET", url: "/admin/private" })).statusCode, 401);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/admin/auth/login",
          payload: { email: "admin@flowmind.local", password: "wrong-password" },
        })
      ).statusCode,
      401,
    );

    const login = await server.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { email: "ADMIN@FLOWMIND.LOCAL", password: "correct-password" },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.email, "admin@flowmind.local");
    const setCookie = login.headers["set-cookie"];
    assert.ok(setCookie);
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /correct-password/);

    assert.equal(
      (
        await server.inject({
          method: "GET",
          url: "/admin/private",
          headers: { cookie },
        })
      ).statusCode,
      200,
    );

    const logout = await server.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers: { cookie },
    });
    assert.equal(logout.statusCode, 200);
    assert.equal(
      (
        await server.inject({
          method: "GET",
          url: "/admin/private",
          headers: { cookie },
        })
      ).statusCode,
      401,
    );
  } finally {
    await server.close();
    await rm(storagePath, { force: true, recursive: true });
  }
});

test("password hashing uses a unique salt and rejects malformed hashes", async () => {
  const hasher = createPasswordHasher();
  const first = await hasher.hash("a-secure-password");
  const second = await hasher.hash("a-secure-password");
  assert.notEqual(first, second);
  assert.equal(await hasher.verify("a-secure-password", first), true);
  assert.equal(await hasher.verify("incorrect-password", first), false);
  assert.equal(await hasher.verify("a-secure-password", "invalid"), false);
  await assert.rejects(hasher.hash("short"), /12/);
});
