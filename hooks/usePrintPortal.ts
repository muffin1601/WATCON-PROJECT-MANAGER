"use client";

import { useState } from "react";
import { flushSync } from "react-dom";

// Drives the #printArea portal (see styles/globals.css) synchronously: sets
// the print target, forces React to commit it to the DOM immediately (so the
// portal content exists before the browser's print dialog opens), fires
// window.print(), then clears. Deliberately NOT effect-driven — calling
// setState from a useEffect after window.print() causes cascading renders
// and trips the react-hooks/set-state-in-effect rule; doing it all inside
// the click handler avoids that entirely.
export function usePrintPortal<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const printArea = typeof document !== "undefined" ? document.getElementById("printArea") : null;

  function print(value: T) {
    flushSync(() => setTarget(value));
    window.print();
    setTarget(null);
  }

  return { target, printArea, print };
}
