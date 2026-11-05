/* South Italy – site behaviour (no dependencies) */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- nav ---------- */
  const nav = $("#nav");
  const burger = $("#burger");
  const mobileNav = $("#mobileNav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (burger) {
    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
      document.body.style.overflow = open ? "hidden" : "";
    };
    burger.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
    $$("a", mobileNav).forEach((a) => a.addEventListener("click", () => setOpen(false)));
  }

  /* active section link (desktop) */
  const links = $$(".nav-links a[href^='#']");
  const sections = links.map((a) => $(a.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            links.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === "#" + e.target.id));
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    sections.forEach((s) => io.observe(s));
  }

  /* ---------- reveal on scroll ---------- */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const ro = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } }),
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach((el) => ro.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- timeline ---------- */
  const tl = $("#timeline");
  const tlProgress = $("#tlProgress");
  if (tl && tlProgress) {
    const items = $$(".tl-item", tl);
    const tick = () => {
      const r = tl.getBoundingClientRect();
      const vh = window.innerHeight;
      const focus = vh * 0.62;                      // "now" line in viewport
      const h = Math.min(Math.max(focus - r.top, 0), r.height);
      tlProgress.style.height = h + "px";
      items.forEach((it) => {
        const ir = it.getBoundingClientRect();
        it.classList.toggle("on", ir.top < focus);
      });
    };
    tick();
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick);
  }

  /* ---------- sticky mobile CTA ---------- */
  const cta = $("#mobileCta");
  const hero = $(".hero, .togo-hero");
  const resv = $("#reservieren");
  if (cta && hero) {
    const check = () => {
      const pastHero = hero.getBoundingClientRect().bottom < 0;
      const atForm = resv ? resv.getBoundingClientRect().top < window.innerHeight * 0.6 : false;
      cta.classList.toggle("show", pastHero && !atForm && !nav.classList.contains("open"));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
  }

  /* ---------- lightbox ---------- */
  const grid = $("#galerie-grid");
  const lb = $("#lightbox");
  if (grid && lb) {
    const img = $("#lbImg", lb);
    const anchors = $$("a", grid);
    let i = 0;
    const show = (n) => {
      i = (n + anchors.length) % anchors.length;
      img.src = anchors[i].getAttribute("href");
      img.alt = $("img", anchors[i]).alt;
      lb.classList.add("open");
      lb.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    };
    const hide = () => { lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };
    anchors.forEach((a, n) => a.addEventListener("click", (e) => { e.preventDefault(); show(n); }));
    $("#lbClose").addEventListener("click", hide);
    $("#lbPrev").addEventListener("click", () => show(i - 1));
    $("#lbNext").addEventListener("click", () => show(i + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) hide(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") hide();
      if (e.key === "ArrowLeft") show(i - 1);
      if (e.key === "ArrowRight") show(i + 1);
    });
    let x0 = null;
    lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) show(dx < 0 ? i + 1 : i - 1);
      x0 = null;
    });
  }

  /* ---------- reservation form ---------- */
  const form = $("#resForm");
  if (form) {
    const msg = $("#formMsg");
    const cfg = window.SI_CONFIG || {};
    const dateInput = $("#f-date");
    if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.className = "form-msg";
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      if (data.website) return; // honeypot
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        if (cfg.formEndpoint) {
          const res = await fetch(cfg.formEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, source: "south-italy-website" }),
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
        } else {
          // Fallback until the form worker is live: open the mail client pre-filled
          const body = [
            `Reservierungsanfrage über die Website`,
            ``,
            `Name: ${data.name}`,
            `Telefon: ${data.tel}`,
            `E-Mail: ${data.email || "-"}`,
            `Datum: ${data.date}  Uhrzeit: ${data.time}`,
            `Personen: ${data.guests}`,
            `Nachricht: ${data.message || "-"}`,
          ].join("\n");
          window.location.href = `mailto:${cfg.mail}?subject=${encodeURIComponent("Reservierung " + data.date + " " + data.time + " – " + data.name)}&body=${encodeURIComponent(body)}`;
        }
        msg.textContent = "Grazie! Ihre Anfrage ist unterwegs – wir melden uns schnellstmöglich. Für kurzfristige Reservierungen rufen Sie bitte an: 07042 / 375 22 83.";
        msg.classList.add("ok");
        form.reset();
      } catch (err) {
        msg.textContent = "Das hat leider nicht geklappt. Bitte rufen Sie uns direkt an: 07042 / 375 22 83.";
        msg.classList.add("err");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Mittagstisch / Special (live aus dem Admin, sonst statische Karte) ---------- */
  (function liveMittag() {
    const card = $("#mittagCard");
    const special = $("#mittagSpecial");
    if (!card || !window.fetch) return;

    const fmt = (iso) => (iso ? iso.split("-").reverse().join(".") : "");
    const range = (s) =>
      s.validFrom && s.validTo ? `${fmt(s.validFrom)} – ${fmt(s.validTo)}` : s.validTo ? `bis ${fmt(s.validTo)}` : s.validFrom ? `ab ${fmt(s.validFrom)}` : "";

    function media(s, label) {
      const a = document.createElement("a");
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
      if (s.type === "image") {
        a.className = "live-media";
        const img = document.createElement("img");
        img.src = s.url;
        img.alt = s.title || label;
        img.loading = "lazy";
        a.appendChild(img);
      } else {
        a.className = "live-pdf";
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
        const t = document.createElement("span");
        t.textContent = `${label} als PDF öffnen`;
        a.appendChild(t);
      }
      return a;
    }

    function caption(s) {
      const p = document.createElement("p");
      p.className = "live-cap";
      p.textContent = [s.title, range(s)].filter(Boolean).join(" · ");
      return p;
    }

    fetch("/api/mittag", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const m = d.slots && d.slots.mittagstisch;
        if (m && m.active) {
          card.classList.add("is-live");
          card.replaceChildren(media(m, "Wochenkarte"), caption(m));
          const btn = $("#mittagBtn");
          if (btn) btn.href = m.url;
        }
        const sp = d.slots && d.slots.special;
        if (sp && sp.active && special) {
          const eb = document.createElement("span");
          eb.className = "eyebrow";
          eb.textContent = "Special";
          const h = document.createElement("h3");
          h.textContent = sp.title || "Aktuell bei uns";
          special.replaceChildren(eb, h, media(sp, "Special"), caption(sp));
          special.hidden = false;
        }
      })
      .catch(() => {
        /* statische Karte bleibt */
      });
  })();

  /* ---------- misc ---------- */
  const y = $("#year");
  if (y) y.textContent = new Date().getFullYear();

  /* pause hero video when not visible (battery) */
  const vid = $(".hero video");
  if (vid && "IntersectionObserver" in window) {
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? vid.play().catch(() => {}) : vid.pause())), { threshold: 0.1 }).observe(vid);
  }
})();
