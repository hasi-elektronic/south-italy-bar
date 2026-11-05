import { isAdmin, SLOTS } from "../../_lib/auth.js";
import { getMeta, isActive } from "../../_lib/mittag.js";

// GET /mittag/aktuell/mittagstisch  -> liefert die aktuell hochgeladene Datei (PDF/Bild).
// Öffentlich nur, solange der Slot im Gültigkeitszeitraum liegt. Admin sieht immer (Vorschau).
export async function onRequestGet({ request, env, params }) {
  const slot = String(params.slot || "");
  if (!SLOTS.includes(slot)) return new Response("Not found", { status: 404 });

  const meta = await getMeta(env, slot);
  if (!meta) return new Response("Not found", { status: 404 });
  if (!isActive(meta) && !(await isAdmin(request, env))) return new Response("Not found", { status: 404 });

  const obj = await env.UPLOADS.get(meta.key);
  if (!obj) return new Response("Not found", { status: 404 });

  return new Response(obj.body, {
    headers: {
      "content-type": meta.mime,
      "content-disposition": `inline; filename="${slot}.${meta.mime === "application/pdf" ? "pdf" : meta.mime.split("/")[1].replace("jpeg", "jpg")}"`,
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}
