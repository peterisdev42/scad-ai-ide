(() => {
  "use strict";

  const root = document.documentElement;
  const toggle = document.querySelector("[data-theme-toggle]");
  const year = document.querySelector("[data-year]");
  const header = document.querySelector(".site-header");

  // Keep anchor targets aligned immediately beneath the actual sticky header.
  // The header changes height at smaller viewport widths and browser zoom levels.
  if (header) {
    const updateHeaderOffset = () => {
      const height = header.getBoundingClientRect().height;
      root.style.setProperty("--header-height", `${height}px`);
    };
    updateHeaderOffset();
    if ("ResizeObserver" in window) {
      new ResizeObserver(updateHeaderOffset).observe(header);
    } else {
      window.addEventListener("resize", updateHeaderOffset);
    }
  }

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    const dark = theme === "dark";
    if (toggle) {
      toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      toggle.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0d1119" : "#f8fafc");
  }

  applyTheme(root.dataset.theme === "dark" ? "dark" : "light");

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("scad-theme", next); } catch { /* Private browsing */ }
    });
  }
})();
