/* Site-only behavior. Theme ownership lives exclusively in geist/theme.js. */
(() => {
  "use strict";
  const root = document.documentElement;
  const year = document.querySelector("[data-year]");
  const header = document.querySelector(".site-header");
  if (header) {
    // One source of truth for native fragment navigation. No extra margin,
    // no global smooth scrolling during refresh/history restoration.
    const update = () => root.style.setProperty("--header-height", header.getBoundingClientRect().height + "px");
    update();
    if ("ResizeObserver" in window) new ResizeObserver(update).observe(header);
    else window.addEventListener("resize", update);
    // A direct fragment URL may be positioned before fonts/header settle.
    // Correct only the initial fragment navigation, never normal reload
    // restoration or a user who has already begun scrolling/interacting.
    const initialHash = location.hash;
    const navType = performance.getEntriesByType("navigation")[0]?.type;
    if (initialHash && navType !== "reload" && navType !== "back_forward") {
      let interacted = false;
      const events = ["pointerdown", "wheel", "touchstart", "keydown", "hashchange"];
      const mark = () => { interacted = true; };
      for (const event of events) window.addEventListener(event, mark, { passive: true, once: true });
      const align = () => {
        for (const event of events) window.removeEventListener(event, mark);
        if (interacted || location.hash !== initialHash) return;
        let target;
        try { target = document.getElementById(decodeURIComponent(initialHash.slice(1))); } catch { return; }
        if (!target) return;
        update();
        const delta = target.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
      };
      const ready = () => Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(align));
      if (document.readyState === "complete") ready();
      else window.addEventListener("load", ready, { once: true });
    }
  }
  if (year) year.textContent = String(new Date().getFullYear());
})();
