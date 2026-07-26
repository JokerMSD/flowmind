import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { createAdminAuthHook, registerAdminAuthRoutes } from "./index.js";

test("admin auth issues an HttpOnly signed session and protects routes", async () => {
  const server = Fastify();
  const auth = registerAdminAuthRoutes(server, {
    environment: { FLOWMIND_ADMIN_TOKEN: "alpha-secret" },
    ttlMs: 60_000,
  });
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
          payload: { token: "wrong" },
        })
      ).statusCode,
      401,
    );

    const login = await server.inject({
      method: "POST",
      url: "/admin/auth/login",
      payload: { token: "alpha-secret" },
    });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"];
    assert.ok(setCookie);
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /alpha-secret/);

    const protectedRoute = await server.inject({
      method: "GET",
      url: "/admin/private",
      headers: { cookie },
    });
    assert.equal(protectedRoute.statusCode, 200);
    assert.deepEqual(protectedRoute.json(), { ok: true });
  } finally {
    await server.close();
  }
});

test("admin auth fails early without a token unless local development bypass is explicit", () => {
  assert.throws(
    () => registerAdminAuthRoutes(Fastify(), { environment: {} }),
    /FLOWMIND_ADMIN_TOKEN/,
  );
  assert.throws(
    () =>
      registerAdminAuthRoutes(Fastify(), {
        environment: { FLOWMIND_ADMIN_ALLOW_LOCAL_DEV: "true", NODE_ENV: "production" },
      }),
    /NODE_ENV=development/,
  );
});
