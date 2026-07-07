/* Studio Vetrina — interazioni base */
document.addEventListener("DOMContentLoaded", () => {

  // Header shadow on scroll
  const header = document.querySelector(".site-header");
  const onScroll = () => header && header.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile nav toggle
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
    nav.querySelectorAll(".nav-links a").forEach(a =>
      a.addEventListener("click", () => nav.classList.remove("open"))
    );
  }

  // Reveal on scroll
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));

  // ---- Tema chiaro/scuro (switch giorno/notte) ----
  const root = document.documentElement;
  const tbtn = document.querySelector("#theme-toggle");
  try { if (localStorage.getItem("theme") === "dark") root.classList.add("dark"); } catch (e) {}
  const syncSwitch = () => { if (tbtn) tbtn.setAttribute("aria-checked", root.classList.contains("dark") ? "true" : "false"); };
  syncSwitch();
  if (tbtn) tbtn.addEventListener("click", () => {
    root.classList.toggle("dark");
    try { localStorage.setItem("theme", root.classList.contains("dark") ? "dark" : "light"); } catch (e) {}
    syncSwitch();
  });

  // ---- Anteprima live personalizzata (hero) ----
  const bizName = document.querySelector("#biz-name");
  const bizType = document.querySelector("#biz-type");
  if (bizName && bizType) {
    const types = {
      ristorante:   { c1:"#7a2e1e", c2:"#c2603e", tag:"Ristorante · Cucina di casa",  sub:"Prenota il tuo tavolo",       btn:"Prenota ora" },
      bar:          { c1:"#1f3a56", c2:"#3f7bb0", tag:"Bar · Caffetteria",             sub:"Colazioni & aperitivi",       btn:"Scopri" },
      negozio:      { c1:"#274b3f", c2:"#4c8a6f", tag:"Negozio",                            sub:"Scopri i nostri prodotti",    btn:"Vieni a trovarci" },
      parrucchiere: { c1:"#2b2540", c2:"#6c5ba0", tag:"Parrucchiere · Hair stylist",   sub:"Prenota l'appuntamento",      btn:"Prenota" },
      panetteria:   { c1:"#5a3b17", c2:"#c99a4e", tag:"Panetteria · Forno",            sub:"Pane e dolci freschi",        btn:"Scopri" },
      artigiano:    { c1:"#3a2c22", c2:"#a86b3c", tag:"Artigiano · Bottega",           sub:"Al tuo servizio, ogni giorno",btn:"Contattaci" }
    };
    const url  = document.querySelector("#mock-url");
    const tag  = document.querySelector("#mock-tag");
    const head = document.querySelector("#mock-h");
    const btn  = document.querySelector("#mock-btn");
    const strip = document.querySelector("#mock-strip");
    const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "la-tua-attivita";

    const render = () => {
      const t = types[bizType.value] || types.ristorante;
      const name = bizName.value.trim() || "La tua attività";
      if (url)  url.textContent = slug(name) + ".it";
      if (tag)  { tag.textContent = t.tag; tag.style.color = t.c2; }
      if (head) head.innerHTML = name + "<br><span style='font-weight:500;font-size:.82em;color:#6a6459;'>" + t.sub + "</span>";
      if (btn)  { btn.textContent = t.btn; btn.style.background = t.c2; }
      if (strip) strip.style.background = "linear-gradient(90deg," + t.c1 + "," + t.c2 + ")";
    };
    bizName.addEventListener("input", render);
    bizType.addEventListener("change", render);
    render();
  }

  // ---- Glow che segue il cursore nell'hero (solo desktop) ----
  const hero = document.querySelector(".hero");
  const glow = document.querySelector(".hero-glow");
  if (hero && glow && window.matchMedia("(pointer:fine)").matches) {
    hero.addEventListener("mousemove", (e) => {
      const r = hero.getBoundingClientRect();
      glow.style.left = (e.clientX - r.left) + "px";
      glow.style.top  = (e.clientY - r.top) + "px";
      glow.style.opacity = "1";
    });
    hero.addEventListener("mouseleave", () => { glow.style.opacity = "0"; });
  }

  // ---- Contact form (demo — nessun backend collegato) ----
  const form = document.querySelector("#contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const ok = form.querySelector(".form-ok");
      if (ok) ok.style.display = "block";
      form.reset();
    });
  }
});
