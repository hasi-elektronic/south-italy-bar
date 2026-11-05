import { json, isAdmin, sameOrigin, SLOTS, MAX_BYTES } from "../_lib/auth.js";
import { sniff, validDate, cleanTitle, getMeta, view } from "../_lib/mittag.js";

// GET /api/mittag  -> öffentlich: nur aktive Slots. Mit Admin-Cookie: alle Slots inkl. inaktiver.
export async function onRequestGet({ request, env }) {
  const admin = await isAdmin(request, env);
  const out = {};
  for (const slot of SLOTS) {
    const v = view(slot, await getMeta(env, slot), admin);
    out[slot] = admin || v.active ? v : { slot, exists: false, active: false };
  }
  return json({ admin, slots: out }, 200, admin ? {} : { "cache-control": "public, max-age=60" });
}

// POST /api/mittag  (multipart: slot, file?, title?, validFrom?, validTo?)
export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Nicht angemeldet." }, 401);
  if (!sameOrigin(request)) return json({ error: "Ungültige Anfrage." }, 403);

  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BYTES + 64 * 1024) return json({ error: "Datei zu groß (max. 10 MB)." }, 413);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const slot = String(form.get("slot") || "");
  if (!SLOTS.includes(slot)) return json({ error: "Unbekannter Bereich." }, 400);

  const validFrom = String(form.get("validFrom") || "").trim();
  const validTo = String(form.get("validTo") || "").trim();
  if (validFrom && !validDate(validFrom)) return json({ error: "Ungültiges Datum bei „Gültig ab“." }, 400);
  if (validTo && !validDate(validTo)) return json({ error: "Ungültiges Datum bei „Gültig bis“." }, 400);
  if (validFrom && validTo && validFrom > validTo) return json({ error: "„Gültig ab“ liegt nach „Gültig bis“." }, 400);
  const title = cleanTitle(form.get("title"));

  const old = await getMeta(env, slot);
  const file = form.get("file");
  const hasFile = file && typeof file === "object" && typeof file.arrayBuffer === "function" && file.size > 0;

  // Nur Daten/Titel ändern, ohne neue Datei
  if (!hasFile) {
    if (!old) return json({ error: "Bitte eine Datei auswählen." }, 400);
    const meta = { ...old, title, validFrom, validTo };
    await env.META.put(`slot:${slot}`, JSON.stringify(meta));
    return json({ ok: true, slot: view(slot, meta, true) });
  }

  if (file.size > MAX_BYTES) return json({ error: "Datei zu groß (max. 10 MB)." }, 413);

  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return json({ error: "Nur PDF, JPG, PNG oder WebP erlaubt." }, 415);

  const uploadedAt = Date.now();
  const key = `mittag/${slot}-${uploadedAt}.${kind.ext}`;
  await env.UPLOADS.put(key, buf, { httpMetadata: { contentType: kind.mime } });

  const meta = { key, type: kind.type, mime: kind.mime, size: buf.length, title, validFrom, validTo, uploadedAt };
  await env.META.put(`slot:${slot}`, JSON.stringify(meta));

  if (old?.key && old.key !== key) {
    try {
      await env.UPLOADS.delete(old.key);
    } catch {
      /* alte Datei bleibt liegen – unkritisch */
    }
  }
  return json({ ok: true, slot: view(slot, meta, true) });
}

// DELETE /api/mittag?slot=mittagstisch
export async function onRequestDelete({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: "Nicht angemeldet." }, 401);
  if (!sameOrigin(request)) return json({ error: "Ungültige Anfrage." }, 403);

  const slot = new URL(request.url).searchParams.get("slot") || "";
  if (!SLOTS.includes(slot)) return json({ error: "Unbekannter Bereich." }, 400);

  const old = await getMeta(env, slot);
  if (old?.key) await env.UPLOADS.delete(old.key);
  await env.META.delete(`slot:${slot}`);
  return json({ ok: true });
}
