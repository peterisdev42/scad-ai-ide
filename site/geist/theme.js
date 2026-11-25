/* Load in <head> before CSS; no OS override on a first visit. */
(() => {
  "use strict";
  const root = document.documentElement;
  const key = "scad-theme";
  const normalize = value => value === "dark" ? "dark" : "light";
  function apply(value) {
    const theme = normalize(value);
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#000000" : "#ffffff";
    const toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
  }
  try { apply(localStorage.getItem(key)); } catch { apply("light"); }
  document.addEventListener("DOMContentLoaded", () => {
    apply(root.dataset.theme);
    const toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(key, next); } catch { /* Storage may be disabled. */ }
      });
    }
  }, { once: true });
  window.addEventListener("storage", event => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
