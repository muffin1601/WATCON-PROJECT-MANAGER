/**
 * pdfjs-dist's legacy (Node) build instantiates `new DOMMatrix()` at module
 * top level (as a rendering-path constant) and references `Path2D`/
 * `ImageData` in canvas-rendering code. None of that runs on the path we
 * use — we only call getText()/getInfo(), never render to a canvas — but the
 * module still crashes on *load* if these globals are missing and
 * `@napi-rs/canvas` (its optional native polyfill provider) isn't available
 * in the deployment's traced file set. These are inert stand-ins good enough
 * to satisfy construction and chained calls without ever being exercised.
 *
 * Must be imported before anything that imports "pdf-parse" or "pdfjs-dist".
 */

function ensureGlobal(name: string, factory: () => unknown) {
  const g = globalThis as Record<string, unknown>;
  if (typeof g[name] === "undefined") {
    g[name] = factory();
  }
}

ensureGlobal("DOMMatrix", () => {
  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = init[0]!;
        this.b = init[1]!;
        this.c = init[2]!;
        this.d = init[3]!;
        this.e = init[4]!;
        this.f = init[5]!;
      }
    }
    multiply(): DOMMatrixPolyfill {
      return new DOMMatrixPolyfill();
    }
    multiplySelf(): this {
      return this;
    }
    preMultiplySelf(): this {
      return this;
    }
    translate(): DOMMatrixPolyfill {
      return new DOMMatrixPolyfill();
    }
    scale(): DOMMatrixPolyfill {
      return new DOMMatrixPolyfill();
    }
    invertSelf(): this {
      return this;
    }
    transformPoint(point?: { x: number; y: number }): { x: number; y: number } {
      return { x: point?.x ?? 0, y: point?.y ?? 0 };
    }
  }
  return DOMMatrixPolyfill;
});

ensureGlobal("Path2D", () => {
  class Path2DPolyfill {
    addPath(): void {}
  }
  return Path2DPolyfill;
});

ensureGlobal("ImageData", () => {
  class ImageDataPolyfill {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height?: number
    ) {}
  }
  return ImageDataPolyfill;
});

export {};
