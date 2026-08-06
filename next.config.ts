import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js and pdf-parse (which wraps pdf.js) both resolve worker
  // scripts via runtime path lookups against real node_modules paths —
  // Turbopack/webpack bundling rewrites those paths and breaks them
  // ("Cannot find module '...worker-script/node/index.js'" /
  //  "Setting up fake worker failed: Cannot find module '...pdf.worker.mjs'").
  // serverExternalPackages tells Next.js to leave them un-bundled on the
  // server so Node's normal module resolution handles them.
  serverExternalPackages: ["tesseract.js", "pdf-parse", "@napi-rs/canvas"],

  // serverExternalPackages keeps these un-bundled, but Next's file tracer
  // still decides what actually ships with each serverless function by
  // static analysis — and misses pdfjs-dist's worker script (loaded via a
  // runtime path lookup, not a static import) and @napi-rs/canvas's native
  // binary. Without this, both crash at runtime on Vercel with "Cannot find
  // module" even though they're present in node_modules at build time.
  outputFileTracingIncludes: {
    "/api/ai/extract": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/@napi-rs/canvas*/**",
    ],
    "/api/parse-order": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/@napi-rs/canvas*/**",
    ],
    "/api/documents/[documentId]/extract-text": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/@napi-rs/canvas*/**",
    ],
  },
};

export default nextConfig;
