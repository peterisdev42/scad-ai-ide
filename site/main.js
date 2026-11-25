/* Site-only behavior. Theme ownership lives exclusively in geist/theme.js. */
(() => {
  "use strict";
  const root = document.documentElement;
  const year = document.querySelector("[data-year]");
  const header = document.querySelector(".site-header");
  if (header) {
    const update = () => root.style.setProperty("--header-height", header.getBoundingClientRect().height + "px");
    update();
    if ("ResizeObserver" in window) new ResizeObserver(update).observe(header);
    else window.addEventListener("resize", update);
  }
  if (year) year.textContent = String(new Date().getFullYear());
})();
