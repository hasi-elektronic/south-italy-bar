import { json, sessionCookie, sameOrigin } from "../_lib/auth.js";

// POST /api/logout -> Cookie löschen
export async function onRequestPost({ request }) {
  if (!sameOrigin(request)) return json({ error: "Ungültige Anfrage." }, 403);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
}
