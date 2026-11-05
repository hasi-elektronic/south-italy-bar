// Gemeinsame Helfer: Session-Cookie (HMAC), Rate-Limit, JSON-Antworten.
// Keine Secrets im Code – ADMIN_PASSWORD und SESSION_SECRET kommen aus der Umgebung.

export const COOKIE = "si_admin";
export const SESSION_SECONDS = 7 * 24 * 3600; // 7 Tage
export const SLOTS = ["mittagstisch", "special"];
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const enc = new TextEncoder();

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

// Nur Ja/Nein-Hinweise für die Fehlersuche – niemals Werte oder Längen ausgeben.
export function diagnose(env) {
  return { passwordSet: Boolean(env.ADMIN_PASSWORD), secretSet: Boolean(env.SESSION_SECRET), secretLongEnough: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 16), envKeys: Object.keys(env || {}).filter((k) => !k.startsWith('CF_')) };
}

export function configured(env) {
  return Boolean(env.ADMIN_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 16);
}

function b64url(buf) {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// Konstantzeit-Vergleich über SHA-256-Digests (gleiche Länge, kein Längen-Leak).
export async function safeEqual(a, b) {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `v1.${exp}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export async function isAdmin(request, env) {
  if (!configured(env)) return false;
  const token = readCookie(request, COOKIE);
  const m = /^(v1\.(\d+))\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return false;
  if (Number(m[2]) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(await hmac(env.SESSION_SECRET, m[1]), m[3]);
}

export function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

// Schutz gegen Cross-Site-Requests bei schreibenden Aktionen.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// Rate-Limit: max. 5 Fehlversuche pro 10 Minuten und IP (KV, Ablauf automatisch).
export const RL_MAX = 5;
export const RL_WINDOW = 600;

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}

export async function rlCount(env, ip) {
  const v = await env.META.get(`rl:${ip}`);
  return v ? parseInt(v, 10) || 0 : 0;
}

export async function rlFail(env, ip) {
  const n = (await rlCount(env, ip)) + 1;
  await env.META.put(`rl:${ip}`, String(n), { expirationTtl: RL_WINDOW });
  return n;
}

export async function rlReset(env, ip) {
  await env.META.delete(`rl:${ip}`);
}
