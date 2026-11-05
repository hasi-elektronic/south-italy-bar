import { json, configured, diagnose, isAdmin, safeEqual, makeToken, sessionCookie, sameOrigin, clientIp, rlCount, rlFail, rlReset, RL_MAX, RL_WINDOW, SESSION_SECONDS } from "../_lib/auth.js";

// GET  /api/login  -> { loggedIn: boolean }
export async function onRequestGet({ request, env }) {
  return json({ loggedIn: await isAdmin(request, env), configured: configured(env), ...(configured(env) ? {} : { diagnose: diagnose(env) }) });
}

// POST /api/login  { password }  -> setzt HttpOnly-Cookie
export async function onRequestPost({ request, env }) {
  if (!configured(env)) return json({ error: "Admin ist noch nicht eingerichtet." }, 503);
  if (!sameOrigin(request)) return json({ error: "Ungültige Anfrage." }, 403);

  const ip = clientIp(request);
  if ((await rlCount(env, ip)) >= RL_MAX) {
    return json({ error: "Zu viele Versuche. Bitte in 10 Minuten erneut versuchen." }, 429, { "retry-after": String(RL_WINDOW) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const pw = typeof body?.password === "string" ? body.password : "";
  if (!pw || pw.length > 200 || !(await safeEqual(pw, env.ADMIN_PASSWORD))) {
    const n = await rlFail(env, ip);
    const left = Math.max(0, RL_MAX - n);
    return json({ error: left ? `Falsches Passwort. Noch ${left} Versuch${left === 1 ? "" : "e"}.` : "Zu viele Versuche. Bitte in 10 Minuten erneut versuchen." }, left ? 401 : 429);
  }

  await rlReset(env, ip);
  const token = await makeToken(env);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, token, SESSION_SECONDS) });
}
