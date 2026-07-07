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

  // Contact form (demo — nessun backend collegato)
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
