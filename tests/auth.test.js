import { test } from "node:test";
import assert from "node:assert";
import {
  hashPassword, verifyPassword, timingSafeEqual, newSessionToken,
  sha256Hex, parseCookies, sessionCookie, createUser, createCustomer,
  login, logout, identify, isAdmin, contractorMayAccess, SESSION_COOKIE
} from "../src/auth.js";

/* ------------------------------------------------------------------
   A minimal in-memory stand-in for the D1-backed db object from db.js.
   Implements only what auth.js calls: first / all / run / insert / update.
   SQL is matched by pattern rather than parsed — enough to exercise the
   real auth logic without a live D1 binding.
   ------------------------------------------------------------------ */
function fakeDb() {
  const tables = { users: [], sessions: [], customers: [] };
  let seq = 0;
  const uid = () => `id_${++seq}`;

  return {
    _tables: tables,
    async insert(table, obj) {
      const row = { id: obj.id || uid(), created_at: new Date().toISOString(), ...obj };
      tables[table].push(row);
      return row;
    },
    async update(table, id, patch) {
      const row = tables[table].find(r => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return row;
    },
    async first(sql, ...binds) {
      if (sql.includes("FROM users WHERE username"))
        return tables.users.find(u => u.username === binds[0]) || null;
      if (sql.includes("FROM users WHERE id"))
        return tables.users.find(u => u.id === binds[0]) || null;
      if (sql.includes("FROM sessions WHERE token_hash"))
        return tables.sessions.find(s => s.token_hash === binds[0] && !s.revoked_at) || null;
      if (sql.includes("FROM customers WHERE id"))
        return tables.customers.find(c => c.id === binds[0]) || null;
      return null;
    },
    async all() { return []; },
    async run(sql, ...binds) {
      if (sql.startsWith("UPDATE sessions SET revoked_at") && sql.includes("token_hash")) {
        const s = tables.sessions.find(x => x.token_hash === binds[1]);
        if (s) s.revoked_at = binds[0];
      }
      if (sql.startsWith("UPDATE sessions SET revoked_at") && sql.includes("user_id")) {
        for (const s of tables.sessions) if (s.user_id === binds[1]) s.revoked_at = binds[0];
      }
      return { success: true };
    }
  };
}

const req = (headers = {}) => ({ headers: { get: k => headers[k.toLowerCase()] ?? null } });

/* ---------------- password hashing ---------------- */

test("password hashes are salted, so the same password never stores identically", async () => {
  const a = await hashPassword("correct-horse-battery");
  const b = await hashPassword("correct-horse-battery");
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith("pbkdf2$210000$"));
});

test("verifyPassword accepts the right password and rejects the wrong one", async () => {
  const stored = await hashPassword("correct-horse-battery");
  assert.strictEqual(await verifyPassword("correct-horse-battery", stored), true);
  assert.strictEqual(await verifyPassword("Correct-horse-battery", stored), false);
  assert.strictEqual(await verifyPassword("", stored), false);
});

test("verifyPassword rejects malformed or absent hashes rather than throwing", async () => {
  assert.strictEqual(await verifyPassword("x", null), false);
  assert.strictEqual(await verifyPassword("x", "notahash"), false);
  assert.strictEqual(await verifyPassword("x", "pbkdf2$1$aa$bb"), false); // iterations too low
});

test("short passwords are refused at creation", async () => {
  await assert.rejects(() => hashPassword("short"), /at least 8/);
});

test("timingSafeEqual behaves like equality", () => {
  assert.strictEqual(timingSafeEqual("abc", "abc"), true);
  assert.strictEqual(timingSafeEqual("abc", "abd"), false);
  assert.strictEqual(timingSafeEqual("abc", "abcd"), false);
  assert.strictEqual(timingSafeEqual(null, "abc"), false);
});

/* ---------------- sessions ---------------- */

test("session tokens are unique and URL-safe", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = newSessionToken();
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.ok(!seen.has(t), "token collision");
    seen.add(t);
  }
});

test("only the hash of a session token is stored, never the token", async () => {
  const db = fakeDb();
  const customer = await createCustomer(db, { company_name: "ABC Window Films" });
  await createUser(db, { username: "abc", password: "password123", customerId: customer.id });
  const { token } = await login(db, { username: "abc", password: "password123" });

  const row = db._tables.sessions[0];
  assert.notStrictEqual(row.token_hash, token);
  assert.strictEqual(row.token_hash, await sha256Hex(token));
});

test("cookie parsing and the Set-Cookie flags", () => {
  const cookies = parseCookies(req({ cookie: `${SESSION_COOKIE}=abc123; other=x` }));
  assert.strictEqual(cookies[SESSION_COOKIE], "abc123");

  const header = sessionCookie("tok");
  assert.ok(header.includes("HttpOnly"), "must be HttpOnly");
  assert.ok(header.includes("Secure"), "must be Secure");
  assert.ok(header.includes("SameSite=Lax"));
});

/* ---------------- login flow ---------------- */

test("login rejects a wrong password and a nonexistent user identically", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  await createUser(db, { username: "abc", password: "password123", customerId: c.id });

  await assert.rejects(() => login(db, { username: "abc", password: "wrong" }),
    /Incorrect username or password/);
  await assert.rejects(() => login(db, { username: "ghost", password: "whatever" }),
    /Incorrect username or password/);
});

test("an account locks after repeated failures", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  await createUser(db, { username: "abc", password: "password123", customerId: c.id });

  for (let i = 0; i < 8; i++) {
    await assert.rejects(() => login(db, { username: "abc", password: "nope" }));
  }
  // Correct password now still refused, because the account is locked.
  await assert.rejects(() => login(db, { username: "abc", password: "password123" }),
    /Too many failed attempts/);
});

test("a disabled account cannot log in", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  const u = await createUser(db, { username: "abc", password: "password123", customerId: c.id });
  await db.update("users", u.id, { is_active: 0 });
  await assert.rejects(() => login(db, { username: "abc", password: "password123" }), /disabled/);
});

test("usernames are unique and case-insensitive", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  await createUser(db, { username: "ABC", password: "password123", customerId: c.id });
  await assert.rejects(
    () => createUser(db, { username: "abc", password: "password123", customerId: c.id }),
    /already taken/);
});

test("a contractor user must be attached to a customer", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => createUser(db, { username: "orphan", password: "password123" }),
    /must belong to a customer/);
});

/* ---------------- identity + authorization ---------------- */

test("identify resolves a valid session to that user's customer", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC Window Films" });
  await createUser(db, { username: "abc", password: "password123", customerId: c.id });
  const { token } = await login(db, { username: "abc", password: "password123" });

  const actor = await identify(req({ cookie: `${SESSION_COOKIE}=${token}` }), {}, db);
  assert.strictEqual(actor.kind, "contractor");
  assert.strictEqual(actor.customerId, c.id);
  assert.strictEqual(isAdmin(actor), false);
});

test("a revoked session stops working immediately", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  await createUser(db, { username: "abc", password: "password123", customerId: c.id });
  const { token } = await login(db, { username: "abc", password: "password123" });

  await logout(db, token);
  const actor = await identify(req({ cookie: `${SESSION_COOKIE}=${token}` }), {}, db);
  assert.strictEqual(actor, null);
});

test("an expired session is not accepted", async () => {
  const db = fakeDb();
  const c = await createCustomer(db, { company_name: "ABC" });
  await createUser(db, { username: "abc", password: "password123", customerId: c.id });
  const { token } = await login(db, { username: "abc", password: "password123" });

  db._tables.sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(await identify(req({ cookie: `${SESSION_COOKIE}=${token}` }), {}, db), null);
});

test("a garbage cookie is not a session", async () => {
  const db = fakeDb();
  assert.strictEqual(await identify(req({ cookie: `${SESSION_COOKIE}=nonsense` }), {}, db), null);
});

test("APP_PASSWORD basic auth still grants admin, and a wrong one does not", async () => {
  const db = fakeDb();
  const good = "Basic " + Buffer.from("admin:s3cret").toString("base64");
  const bad = "Basic " + Buffer.from("admin:wrong").toString("base64");

  const actor = await identify(req({ authorization: good }), { APP_PASSWORD: "s3cret" }, db);
  assert.strictEqual(actor.kind, "legacy-admin");
  assert.strictEqual(isAdmin(actor), true);

  assert.strictEqual(await identify(req({ authorization: bad }), { APP_PASSWORD: "s3cret" }, db), null);
});

test("contractors are confined to portal routes", () => {
  assert.strictEqual(contractorMayAccess("/api/portal/leads"), true);
  assert.strictEqual(contractorMayAccess("/api/auth/me"), true);
  // The admin surface and every internal V2 route are off limits.
  assert.strictEqual(contractorMayAccess("/api/v2/projects"), false);
  assert.strictEqual(contractorMayAccess("/api/admin/customers"), false);
  assert.strictEqual(contractorMayAccess("/api/opportunities"), false);
  assert.strictEqual(contractorMayAccess("/api/v2/projects/123/pricing"), false);
});
