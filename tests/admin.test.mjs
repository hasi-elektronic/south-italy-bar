// Integrationstest gegen `wrangler pages dev` (http://127.0.0.1:8788).
// Aufruf: node tests/admin.test.mjs   (Passwort wird aus .dev.vars gelesen, nie ausgegeben)
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const FX = process.env.FX || "/tmp/si-fx";
const vars = Object.fromEntries(fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const PW = vars.ADMIN_PASSWORD;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };

let cookie = "";
const H = (extra = {}) => ({ origin: BASE, ...(cookie ? { cookie } : {}), ...extra });

async function login(password, ip) {
  const r = await fetch(BASE + "/api/login", { method: "POST", headers: H({ "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) }), body: JSON.stringify({ password }) });
  const sc = r.headers.get("set-cookie");
  return { r, sc };
}
async function up(fields, fileName, bytes, mime, opts = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (bytes) fd.append("file", new Blob([bytes], { type: mime }), fileName);
  return fetch(BASE + "/api/mittag", { method: "POST", headers: opts.headers ?? H(), body: fd });
}
const read = (f) => fs.readFileSync(`${FX}/${f}`);
const pub = async (p) => fetch(BASE + p, { headers: { origin: BASE } }); // ohne Cookie

// 0) Ausgangslage
let j = await (await pub("/api/mittag")).json();
ok("öffentlich: beide Slots leer", !j.admin && !j.slots.mittagstisch.exists && !j.slots.special.exists, JSON.stringify(j));

// 1) Ohne Cookie
ok("POST ohne Cookie -> 401", (await up({ slot: "mittagstisch" }, "karte.pdf", read("karte.pdf"), "application/pdf", { headers: { origin: BASE } })).status === 401);
ok("DELETE ohne Cookie -> 401", (await fetch(BASE + "/api/mittag?slot=mittagstisch", { method: "DELETE", headers: { origin: BASE } })).status === 401);
ok("Fake-Cookie -> 401", (await up({ slot: "mittagstisch" }, "karte.pdf", read("karte.pdf"), "application/pdf", { headers: { origin: BASE, cookie: "si_admin=v1.9999999999.AAAA" } })).status === 401);

// 2) Login
const bad = await login("falsch-" + Math.random(), "10.0.0.1");
ok("falsches Passwort -> 401", bad.r.status === 401 && !bad.sc);
const noOrigin = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PW }) });
ok("Login ohne Origin -> 403", noOrigin.status === 403);
const good = await login(PW, "10.0.0.2");
ok("richtiges Passwort -> 200 + HttpOnly/SameSite=Strict Cookie", good.r.status === 200 && /HttpOnly/i.test(good.sc) && /SameSite=Strict/i.test(good.sc), good.sc);
cookie = good.sc.split(";")[0];
ok("GET /api/login zeigt loggedIn", (await (await fetch(BASE + "/api/login", { headers: H() })).json()).loggedIn === true);

// 3) Upload-Validierung
ok("11-MB-Datei -> 413", (await up({ slot: "mittagstisch" }, "big.pdf", read("big.pdf"), "application/pdf")).status === 413);
const fake = await up({ slot: "mittagstisch" }, "karte.jpg", read("fake.jpg"), "image/jpeg");
ok("Text als .jpg getarnt -> 415", fake.status === 415, String(fake.status));
ok("unbekannter Slot -> 400", (await up({ slot: "evil" }, "karte.pdf", read("karte.pdf"), "application/pdf")).status === 400);
ok("kein File & leerer Slot -> 400", (await up({ slot: "mittagstisch" })).status === 400);
ok("Cross-Origin POST mit gültigem Cookie -> 403", (await up({ slot: "mittagstisch" }, "karte.pdf", read("karte.pdf"), "application/pdf", { headers: { origin: "https://evil.example", cookie } })).status === 403);
ok("ungültiges Datum -> 400", (await up({ slot: "mittagstisch", validFrom: "2026-13-45" }, "karte.pdf", read("karte.pdf"), "application/pdf")).status === 400);
ok("ab > bis -> 400", (await up({ slot: "mittagstisch", validFrom: "2026-12-10", validTo: "2026-12-01" }, "karte.pdf", read("karte.pdf"), "application/pdf")).status === 400);

// 4) PDF + JPG hochladen, öffentlich sichtbar
const r1 = await up({ slot: "mittagstisch", title: "Woche 46" }, "egal.txt", read("karte.pdf"), "text/plain"); // falscher Name/MIME, Inhalt = PDF
ok("PDF (falscher Name/MIME, echter Inhalt) -> 200 type=pdf", r1.status === 200 && (await r1.json()).slot.type === "pdf");
const r2 = await up({ slot: "special", title: "Muttertag" }, "foto.jpg", read("karte.jpg"), "image/jpeg");
ok("JPG in Special -> 200 type=image", r2.status === 200 && (await r2.json()).slot.type === "image");

j = await (await pub("/api/mittag")).json();
ok("öffentlich: Mittagstisch aktiv (PDF)", j.slots.mittagstisch.active && j.slots.mittagstisch.type === "pdf" && j.slots.mittagstisch.title === "Woche 46", JSON.stringify(j.slots.mittagstisch));
ok("öffentlich: Special aktiv (Bild)", j.slots.special.active && j.slots.special.type === "image");
ok("öffentlich: keine Admin-Felder (size/mime)", j.slots.mittagstisch.size === undefined && j.slots.mittagstisch.mime === undefined);
const s1 = await pub(j.slots.mittagstisch.url);
const b1 = Buffer.from(await s1.arrayBuffer());
ok("PDF-Stream: Content-Type + Bytes identisch + nosniff", s1.headers.get("content-type") === "application/pdf" && b1.equals(read("karte.pdf")) && s1.headers.get("x-content-type-options") === "nosniff");
const s2 = await pub(j.slots.special.url);
ok("JPG-Stream: image/jpeg", s2.headers.get("content-type") === "image/jpeg" && Buffer.from(await s2.arrayBuffer()).equals(read("karte.jpg")));

// 5) Ersetzen (PNG) – Slot zeigt neue Datei
await up({ slot: "mittagstisch" }, "n.png", read("karte.png"), "image/png");
j = await (await pub("/api/mittag")).json();
const s3 = await pub(j.slots.mittagstisch.url);
ok("Ersetzen durch PNG: neuer Typ wird geliefert", j.slots.mittagstisch.type === "image" && s3.headers.get("content-type") === "image/png");

// 6) Gültigkeit
await up({ slot: "mittagstisch", validTo: "2020-01-01" }); // nur Daten ändern
j = await (await pub("/api/mittag")).json();
ok("abgelaufen: öffentlich nicht sichtbar", !j.slots.mittagstisch.active && !j.slots.mittagstisch.exists);
ok("abgelaufen: Stream öffentlich 404", (await pub("/mittag/aktuell/mittagstisch")).status === 404);
const adm = await (await fetch(BASE + "/api/mittag", { headers: H() })).json();
ok("abgelaufen: Admin sieht Slot (inaktiv) + size", adm.slots.mittagstisch.exists && !adm.slots.mittagstisch.active && adm.slots.mittagstisch.size > 0);
ok("abgelaufen: Admin-Vorschau Stream 200", (await fetch(BASE + "/mittag/aktuell/mittagstisch", { headers: H() })).status === 200);
await up({ slot: "mittagstisch", validFrom: "2099-01-01" });
j = await (await pub("/api/mittag")).json();
ok("geplant (Zukunft): öffentlich nicht sichtbar", !j.slots.mittagstisch.active);
await up({ slot: "mittagstisch", validFrom: "2020-01-01", validTo: "2099-12-31" });
j = await (await pub("/api/mittag")).json();
ok("Zeitraum umfasst heute: sichtbar", j.slots.mittagstisch.active);

// 7) WebP + Löschen
ok("WebP akzeptiert", (await up({ slot: "special" }, "x.webp", read("karte.webp"), "image/webp")).status === 200);
ok("DELETE mit Cookie -> 200", (await fetch(BASE + "/api/mittag?slot=special", { method: "DELETE", headers: H() })).status === 200);
j = await (await pub("/api/mittag")).json();
ok("nach Löschen: Special leer (Fallback)", !j.slots.special.exists && (await pub("/mittag/aktuell/special")).status === 404);
ok("Pfad-Trick /mittag/aktuell/..%2f -> 404", (await pub("/mittag/aktuell/..%2fetc")).status === 404);

// 8) Logout
const lo = await fetch(BASE + "/api/logout", { method: "POST", headers: H() });
ok("Logout -> Cookie Max-Age=0", lo.status === 200 && /Max-Age=0/i.test(lo.headers.get("set-cookie") || ""));

// 9) Lockout: 5 Fehlversuche, danach auch das richtige Passwort gesperrt
const ip = "10.9.9." + Math.floor(Math.random() * 200 + 1);
const codes = [];
for (let i = 0; i < 6; i++) codes.push((await login("nope" + i, ip)).r.status);
ok("5 Fehlversuche -> 401, 6. -> 429", codes.slice(0, 4).every((c) => c === 401) && codes[4] === 429 && codes[5] === 429, codes.join(","));
const locked = await login(PW, ip);
ok("richtiges Passwort während Sperre -> 429, kein Cookie", locked.r.status === 429 && !locked.sc);
const other = await login(PW, "10.8.8.8");
ok("andere IP nicht betroffen", other.r.status === 200);

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
