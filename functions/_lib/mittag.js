// Slot-Logik: Metadaten (KV), Gültigkeit, Datei-Erkennung per Magic Bytes.

export const KINDS = {
  pdf: { mime: "application/pdf", ext: "pdf", type: "pdf" },
  jpg: { mime: "image/jpeg", ext: "jpg", type: "image" },
  png: { mime: "image/png", ext: "png", type: "image" },
  webp: { mime: "image/webp", ext: "webp", type: "image" },
};

// Dateityp ausschließlich am Inhalt erkennen – Dateiname und Client-MIME werden ignoriert.
export function sniff(bytes) {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return KINDS.pdf;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return KINDS.jpg;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return KINDS.png;
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return KINDS.webp;
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function cleanTitle(s) {
  return String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 80);
}

// Heutiges Datum in Deutschland (YYYY-MM-DD).
export function todayBerlin() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

export function isActive(meta, today = todayBerlin()) {
  if (!meta) return false;
  if (meta.validFrom && today < meta.validFrom) return false;
  if (meta.validTo && today > meta.validTo) return false;
  return true;
}

export async function getMeta(env, slot) {
  const raw = await env.META.get(`slot:${slot}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Öffentliche bzw. Admin-Sicht auf einen Slot.
export function view(slot, meta, admin) {
  if (!meta) return { slot, exists: false, active: false };
  const active = isActive(meta);
  const base = {
    slot,
    exists: true,
    active,
    type: meta.type,
    title: meta.title || "",
    validFrom: meta.validFrom || "",
    validTo: meta.validTo || "",
    uploadedAt: meta.uploadedAt,
    url: `/mittag/aktuell/${slot}?v=${meta.uploadedAt}`,
  };
  if (admin) {
    base.size = meta.size;
    base.mime = meta.mime;
  }
  return base;
}
