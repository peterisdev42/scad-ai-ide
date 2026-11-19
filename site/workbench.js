/* SCAD AI IDE website: standalone visual workbench demo (no real code execution). */
(() => {
  "use strict";
  const demo = document.querySelector("[data-vsc-demo]");
  if (!demo) return;

  const stage = demo.querySelector("[data-vsc-stage]");
  const status = demo.querySelector("[data-vsc-status]");
  const displayMode = demo.querySelector("[data-vsc-display-mode]");
  const fileLabel = demo.querySelector("[data-vsc-file-label]");
  const activeFile = demo.querySelector("[data-vsc-active-file]");
  const explorerButton = demo.querySelector('[data-vsc-action="explorer"]');
  const wireButton = demo.querySelector('[data-vsc-action="wireframe"]');

  const files = new Set(["bracket", "washer"]);
  let selectedFile = "bracket";
  let wireframe = false;
  let angle = 0;
  let pointerStart = null;

  function announce(message) {
    if (status) status.textContent = message;
  }

  function updateRotation() {
    demo.querySelectorAll(".vsc-geometry").forEach(shape => {
      shape.style.transform = `rotate(${angle}deg)`;
    });
  }

  function openFile(file) {
    if (!files.has(file)) return;
    selectedFile = file;
    const fileName = `${file}.scad`;
    demo.dataset.vscFile = file;
    if (fileLabel) fileLabel.textContent = fileName;
    if (activeFile) activeFile.textContent = fileName;

    demo.querySelectorAll("[data-vsc-open]").forEach(button => {
      const isActive = button.dataset.vscOpen === file;
      button.classList.toggle("is-active", isActive);
      if (button.getAttribute("role") === "tab") {
        button.setAttribute("aria-selected", String(isActive));
      } else {
        button.setAttribute("aria-pressed", String(isActive));
      }
    });
    demo.querySelectorAll("[data-vsc-code]").forEach(source => {
      source.hidden = source.dataset.vscCode !== file;
    });
    demo.querySelectorAll("[data-vsc-shape]").forEach(model => {
      model.hidden = model.dataset.vscShape !== file;
    });
    angle = 0;
    updateRotation();
    announce(`Preview ready · ${fileName}`);
  }

  function setWireframe(enabled) {
    wireframe = Boolean(enabled);
    demo.dataset.vscView = wireframe ? "wireframe" : "solid";
    if (wireButton) wireButton.setAttribute("aria-pressed", String(wireframe));
    if (displayMode) displayMode.textContent = `Perspective · ${wireframe ? "Wireframe" : "Solid"}`;
  }

  function setMobilePane(pane) {
    if (pane !== "code" && pane !== "preview") return;
    demo.dataset.mobilePane = pane;
    demo.querySelectorAll("[data-vsc-pane]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.vscPane === pane));
    });
  }

  demo.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !demo.contains(button)) return;

    if (button.dataset.vscOpen) {
      openFile(button.dataset.vscOpen);
      return;
    }
    if (button.dataset.vscPane) {
      setMobilePane(button.dataset.vscPane);
      return;
    }

    switch (button.dataset.vscAction) {
      case "explorer": {
        const hidden = demo.classList.toggle("vsc-explorer-hidden");
        if (explorerButton) {
          explorerButton.classList.toggle("is-active", !hidden);
          explorerButton.setAttribute("aria-pressed", String(!hidden));
        }
        announce(hidden ? "Explorer collapsed" : "Explorer visible");
        break;
      }
      case "search":
        announce("Demo tip: select a file in Explorer or the editor tabs");
        break;
      case "preview":
        setMobilePane("preview");
        announce("CAD preview selected");
        break;
      case "render":
        announce(`Render simulated · ${selectedFile}.scad (no OpenSCAD execution)`);
        break;
      case "wireframe":
        setWireframe(!wireframe);
        announce(`${wireframe ? "Wireframe" : "Solid"} view selected`);
        break;
      case "reset":
        angle = 0;
        updateRotation();
        setWireframe(false);
        announce("View reset · simulated CAD preview");
        break;
      default:
        break;
    }
  });

  if (stage && "PointerEvent" in window) {
    stage.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointerStart = { id: event.pointerId, x: event.clientX, angle };
      stage.classList.add("is-dragging");
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", event => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      angle = Math.max(-42, Math.min(42, pointerStart.angle + (event.clientX - pointerStart.x) / 3));
      updateRotation();
    });
    const stopDrag = event => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      pointerStart = null;
      stage.classList.remove("is-dragging");
    };
    stage.addEventListener("pointerup", stopDrag);
    stage.addEventListener("pointercancel", stopDrag);
    stage.addEventListener("lostpointercapture", stopDrag);
  }

  openFile(selectedFile);
  setWireframe(false);
  setMobilePane("preview");
})();
