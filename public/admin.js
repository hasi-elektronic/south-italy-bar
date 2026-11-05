(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const MAX = 10 * 1024 * 1024;
  const SLOT_INFO = {
    mittagstisch: { title: "Mittagstisch", hint: "Die Wochenkarte (Di–Fr). Erscheint im Bereich „Mittagstisch“ der Startseite." },
    special: { title: "Special / Tagesangebot", hint: "Aktion, Event oder Sonderkarte. Erscheint als eigener Hinweis unter dem Mittagstisch." },
  };

  const el = { login: $("#login"), panel: $("#panel"), slots: $("#slots"), logout: $("#logout"), fatal: $("#fatal"), tpl: $("#slotTpl") };

  function today() {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  }
  const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* leer */
    }
    if (res.status === 401 && path !== "/api/login") {
      showLogin();
      throw new Error("Bitte erneut anmelden.");
    }
    if (!res.ok) throw new Error(data.error || "Das hat leider nicht geklappt (Fehler " + res.status + ").");
    return data;
  }

  function setMsg(node, text, kind) {
    node.textContent = text || "";
    node.className = "msg" + (kind ? " " + kind : "");
  }

  function showLogin() {
    el.panel.hidden = true;
    el.logout.hidden = true;
    el.login.hidden = false;
  }
  function showPanel() {
    el.login.hidden = true;
    el.panel.hidden = false;
    el.logout.hidden = false;
  }

  /* ---------- Foto verkleinern (Handy-Bilder sind oft riesig) ---------- */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1048576) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      return blob && blob.size < file.size ? new File([blob], "karte.jpg", { type: "image/jpeg" }) : file;
    } catch {
      return file; // z. B. HEIC – Server meldet dann verständlich
    }
  }

  function upload(form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/mittag");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        let d = {};
        try {
          d = JSON.parse(xhr.responseText);
        } catch {
          /* leer */
        }
        if (xhr.status === 401) {
          showLogin();
          return reject(new Error("Bitte erneut anmelden."));
        }
        xhr.status >= 200 && xhr.status < 300 ? resolve(d) : reject(new Error(d.error || "Upload fehlgeschlagen (Fehler " + xhr.status + ")."));
      };
      xhr.onerror = () => reject(new Error("Keine Verbindung. Bitte erneut versuchen."));
      xhr.send(form);
    });
  }

  /* ---------- Slot-Karte ---------- */
  function badge(s) {
    if (!s.exists) return ["Leer", "off"];
    const t = today();
    if (s.validFrom && t < s.validFrom) return ["Geplant ab " + fmtDate(s.validFrom), "plan"];
    if (s.validTo && t > s.validTo) return ["Abgelaufen", "off"];
    return ["Online", "on"];
  }

  function renderSlot(name, s) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    const info = SLOT_INFO[name];
    $("h2", node).textContent = info.title;
    $(".hint", node).textContent = info.hint;

    const [btxt, bcls] = badge(s);
    const b = $(".badge", node);
    b.textContent = btxt;
    b.classList.add(bcls);

    const form = $(".slot-form", node);
    const msg = $(".msg", node);
    const prog = $(".prog", node);
    const save = $(".save", node);
    const del = $(".del", node);

    if (s.exists) {
      $(".current", node).hidden = false;
      $(".cur-title", node).textContent = s.title || (s.type === "pdf" ? "PDF-Karte" : "Bild-Karte");
      const range = [s.validFrom && "ab " + fmtDate(s.validFrom), s.validTo && "bis " + fmtDate(s.validTo)].filter(Boolean).join(" · ");
      $(".cur-meta", node).textContent = [s.type === "pdf" ? "PDF" : "Bild", s.size && fmtSize(s.size), range || "ohne Datum"].filter(Boolean).join(" · ");
      const open = $(".cur-open", node);
      open.href = s.url;
      const th = $(".thumb", node);
      if (s.type === "image") {
        const img = document.createElement("img");
        img.src = s.url;
        img.alt = "";
        th.appendChild(img);
      } else {
        th.textContent = "PDF";
      }
      $(".f-title", node).value = s.title || "";
      $(".f-from", node).value = s.validFrom || "";
      $(".f-to", node).value = s.validTo || "";
      save.textContent = "Neue Datei hochladen / speichern";
      del.hidden = false;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setMsg(msg, "");
      const from = $(".f-from", node).value;
      const to = $(".f-to", node).value;
      if (from && to && from > to) return setMsg(msg, "„Gültig ab“ liegt nach „Gültig bis“.", "err");

      let file = $(".f-file", node).files[0];
      if (!file && !s.exists) return setMsg(msg, "Bitte zuerst eine Datei auswählen.", "err");

      save.disabled = del.disabled = true;
      try {
        const fd = new FormData();
        fd.append("slot", name);
        fd.append("title", $(".f-title", node).value);
        fd.append("validFrom", from);
        fd.append("validTo", to);
        if (file) {
          file = await shrink(file);
          if (file.size > MAX) throw new Error("Datei ist zu groß (" + fmtSize(file.size) + "). Maximal 10 MB.");
          fd.append("file", file);
          prog.hidden = false;
          prog.value = 0;
        }
        await upload(fd, (p) => (prog.value = p));
        await load("Gespeichert – die Karte ist jetzt auf der Webseite.", name);
      } catch (err) {
        setMsg(msg, err.message, "err");
        save.disabled = del.disabled = false;
        prog.hidden = true;
      }
    });

    del.addEventListener("click", async () => {
      if (!confirm("„" + info.title + "“ wirklich entfernen? Auf der Webseite erscheint dann wieder die Standard-Ansicht.")) return;
      save.disabled = del.disabled = true;
      try {
        await api("/api/mittag?slot=" + encodeURIComponent(name), { method: "DELETE" });
        await load("Entfernt.", name);
      } catch (err) {
        setMsg(msg, err.message, "err");
        save.disabled = del.disabled = false;
      }
    });

    node.dataset.slot = name;
    return node;
  }

  async function load(okMessage, slotName) {
    const d = await api("/api/mittag");
    if (!d.admin) return showLogin();
    showPanel();
    el.slots.replaceChildren(...Object.keys(SLOT_INFO).map((n) => renderSlot(n, d.slots[n] || { exists: false })));
    if (okMessage && slotName) {
      const m = $(`[data-slot="${slotName}"] .msg`, el.slots);
      if (m) setMsg(m, okMessage, "ok");
    }
  }

  /* ---------- Login / Logout ---------- */
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#loginMsg");
    const btn = $("button", e.currentTarget);
    setMsg(msg, "");
    btn.disabled = true;
    try {
      await api("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: $("#pw").value }),
      });
      $("#pw").value = "";
      await load();
    } catch (err) {
      setMsg(msg, err.message, "err");
    } finally {
      btn.disabled = false;
    }
  });

  el.logout.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      /* egal */
    }
    showLogin();
  });

  /* ---------- Start ---------- */
  (async () => {
    try {
      const s = await api("/api/login");
      if (!s.configured) {
        const d = s.diagnose || {};
        el.fatal.textContent = "Der Admin-Bereich ist noch nicht eingerichtet" + (d.passwordSet === false ? " (ADMIN_PASSWORD fehlt)" : d.secretSet === false ? " (SESSION_SECRET fehlt)" : d.secretLongEnough === false ? " (SESSION_SECRET zu kurz, mind. 16 Zeichen)" : "") + ". Bitte Hamdi Bescheid geben.";
        el.fatal.hidden = false;
        return;
      }
      s.loggedIn ? await load() : showLogin();
    } catch (err) {
      el.fatal.textContent = err.message;
      el.fatal.hidden = false;
    }
  })();
})();
