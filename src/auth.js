/* ============================================================
   auth.js — accounts, passwords, sessions.

   Cloudflare Workers has no bcrypt (it's a native module), so passwords
   use PBKDF2-SHA256 via WebCrypto, which is available in the runtime and
   is a legitimate password KDF. 210,000 iterations matches OWASP's 2023
   guidance for PBKDF2-SHA256.

   Sessions are server-side: the cookie carries a random 256-bit token, and
   only its SHA-256 is stored. A dump of the sessions table therefore can't
   be replayed as a login.
   ============================================================ */

const PBKDF2_ITERATIONS = 210000;
const SESSION_TTL_HOURS = 12;
export const SESSION_COOKIE = "ti_session";

const enc = new TextEncoder();

function b64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Compare two strings without leaking length/content through timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return b64(bits);
}

/** Returns pbkdf2$<iterations>$<salt_b64>$<hash_b64> */
export async function hashPassword(password) {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${hash}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const computed = await pbkdf2(password, fromB64(parts[2]), iterations);
    return timingSafeEqual(computed, parts[3]);
  } catch {
    return false;
  }
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function newSessionToken() {
  return b64(randomBytes(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { maxAgeSeconds = SESSION_TTL_HOURS * 3600 } = {}) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}
export function clearedCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/* ---------------- account operations ---------------- */

export async function createCustomer(db, input) {
  if (!input.company_name) throw new Error("company_name is required");
  return db.insert("customers", {
    company_name: input.company_name,
    contact_name: input.contact_name || null,
    email: input.email || null,
    phone: input.phone || null,
    city: input.city || null,
    state: input.state || null,
    status: input.status || "active",
    billing_cycle: input.billing_cycle || "quarterly",
    billing_model: input.billing_model || "claimed",
    price_per_lead: input.price_per_lead ?? 0,
    price_per_claim: input.price_per_claim ?? 0,
    price_per_bid: input.price_per_bid ?? 0,
    price_per_win: input.price_per_win ?? 0,
    service_states: input.service_states ? JSON.stringify(input.service_states) : null,
    max_distance_miles: input.max_distance_miles ?? null,
    film_types: input.film_types ? JSON.stringify(input.film_types) : null,
    notes: input.notes || null,
    updated_at: new Date().toISOString()
  });
}

export async function createUser(db, { username, password, role = "contractor", customerId = null, email = null, fullName = null, mustChangePassword = false }) {
  const uname = String(username || "").trim().toLowerCase();
  if (!uname || uname.length < 3) throw new Error("Username must be at least 3 characters.");
  if (role === "contractor" && !customerId) throw new Error("A contractor user must belong to a customer.");

  const existing = await db.first("SELECT id FROM users WHERE username = ?", uname);
  if (existing) throw new Error("That username is already taken.");

  return db.insert("users", {
    customer_id: customerId,
    username: uname,
    email,
    password_hash: await hashPassword(password),
    role,
    full_name: fullName,
    is_active: 1,
    must_change_password: mustChangePassword ? 1 : 0,
    updated_at: new Date().toISOString()
  });
}

const MAX_FAILED = 8;
const LOCKOUT_MINUTES = 15;

/**
 * Verifies credentials and issues a session. Returns { token, user } or
 * throws with a deliberately vague message — the caller must not reveal
 * whether the username or the password was the wrong one.
 */
export async function login(db, { username, password, ip, userAgent }) {
  const uname = String(username || "").trim().toLowerCase();
  const user = await db.first("SELECT * FROM users WHERE username = ?", uname);

  // Run a hash even when the user doesn't exist, so response time doesn't
  // reveal which usernames are real.
  if (!user) {
    await verifyPassword(password || "", `pbkdf2$${PBKDF2_ITERATIONS}$${b64(randomBytes(16))}$${b64(randomBytes(32))}`);
    throw new Error("Incorrect username or password.");
  }

  if (!user.is_active) throw new Error("This account is disabled. Contact support.");

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new Error("Too many failed attempts. Try again in a few minutes.");
  }

  const good = await verifyPassword(password || "", user.password_hash);
  if (!good) {
    const failed = (user.failed_attempts || 0) + 1;
    const patch = { failed_attempts: failed };
    if (failed >= MAX_FAILED) {
      patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
      patch.failed_attempts = 0;
    }
    await db.update("users", user.id, patch);
    throw new Error("Incorrect username or password.");
  }

  await db.update("users", user.id, {
    failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString()
  });

  const token = newSessionToken();
  await db.insert("sessions", {
    token_hash: await sha256Hex(token),
    user_id: user.id,
    customer_id: user.customer_id,
    role: user.role,
    ip_address: ip || null,
    user_agent: (userAgent || "").slice(0, 300),
    expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString()
  });

  return { token, user: publicUser(user) };
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    customerId: user.customer_id,
    fullName: user.full_name,
    email: user.email,
    mustChangePassword: Boolean(user.must_change_password)
  };
}

export async function logout(db, token) {
  if (!token) return;
  await db.run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?",
    new Date().toISOString(), await sha256Hex(token));
}

/**
 * Resolves the caller's identity for a request. Returns one of:
 *   { kind: "admin",       userId, customerId: null }
 *   { kind: "contractor",  userId, customerId }
 *   { kind: "legacy-admin" }        — APP_PASSWORD basic auth, no user row
 *   null                            — unauthenticated
 *
 * legacy-admin exists so the operator's existing bookmark keeps working
 * through the transition. It is admin-equivalent, and intentionally the
 * only path that doesn't produce a user id for the audit trail — which is
 * why the admin UI should move to a real account.
 */
export async function identify(request, env, db) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    const row = await db.first(
      "SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL",
      await sha256Hex(token)
    );
    if (row && new Date(row.expires_at) > new Date()) {
      return {
        kind: row.role === "admin" ? "admin" : "contractor",
        userId: row.user_id,
        customerId: row.customer_id || null,
        sessionId: row.id
      };
    }
  }

  // Legacy HTTP Basic with the shared APP_PASSWORD.
  if (env.APP_PASSWORD) {
    const header = request.headers.get("authorization") || "";
    try {
      const decoded = atob(header.split(" ")[1] || "");
      const given = decoded.split(":").slice(1).join(":");
      if (timingSafeEqual(given, env.APP_PASSWORD)) {
        return { kind: "legacy-admin", userId: null, customerId: null };
      }
    } catch { /* fall through */ }
  }

  return null;
}

export function isAdmin(actor) {
  return actor && (actor.kind === "admin" || actor.kind === "legacy-admin");
}

/** Routes a contractor session is permitted to reach. Everything else is admin-only. */
export function contractorMayAccess(path) {
  return path.startsWith("/api/portal/") || path === "/api/auth/me" || path === "/api/auth/logout"
    || path === "/api/auth/change-password";
}
