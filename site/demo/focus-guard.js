// Side-effect import MUST precede Code-OSS / Preview imports. Scope the guard
// to the actual website demo documents, not the marketing page or desktop IDE.
// Code-OSS can invoke native focus/scrollIntoView during deferred startup;
// inert on the outer iframe alone does not make its document inert.
(() => {
  let embedded = false;
  try {
    let frame = window;
    while (frame !== frame.parent) {
      if (frame.frameElement?.hasAttribute('data-vsc-demo')) {
        embedded = true;
        break;
      }
      frame = frame.parent;
    }
  } catch { return; }
  if (!embedded) return;

  // Native pointer/tab interaction still works. Programmatic focus and reveal
  // become available after genuine input in this document, and remain local
  // to an active demo. Background theme updates cannot pull the host page.
  let activated = false;
  const activate = event => {
    if (event.isTrusted) activated = true;
  };
  for (const event of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(event, activate, { capture: true, passive: true });
  }
  const active = () => activated && document.hasFocus();
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(options) {
    if (!active()) return;
    return nativeFocus.call(this, { ...options, preventScroll: true });
  };
  if (typeof SVGElement.prototype.focus === 'function') {
    const nativeSvgFocus = SVGElement.prototype.focus;
    SVGElement.prototype.focus = function(options) {
      if (!active()) return;
      return nativeSvgFocus.call(this, { ...options, preventScroll: true });
    };
  }
  const nativeWindowFocus = window.focus;
  window.focus = function() {
    if (active()) return nativeWindowFocus.call(window);
  };
  const nativeReveal = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function(options) {
    if (active()) return nativeReveal.call(this, options);
  };
  if (typeof Element.prototype.scrollIntoViewIfNeeded === 'function') {
    const nativeRevealIfNeeded = Element.prototype.scrollIntoViewIfNeeded;
    Element.prototype.scrollIntoViewIfNeeded = function(center) {
      if (active()) return nativeRevealIfNeeded.call(this, center);
    };
  }
})();
