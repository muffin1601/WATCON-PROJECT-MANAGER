import type { NextConfig } from "next";

// tesseract.js and pdf-parse (which wraps pdf.js) both resolve worker
// scripts via runtime path lookups / worker_threads against real
// node_modules paths, not static imports. Next's file tracer only ships
// what it can find by static analysis, so on Vercel each of these crashes
// at runtime with "Cannot find module" even though it's present in
// node_modules at build time — one dependency at a time, since the tracer
// stops at the first module it can't statically resolve rather than
// listing everything transitively missing. This is every module under that
// runtime-resolved tree found so far (pdf.js's worker, tesseract.js's
// worker-script tree, and everything *that* requires at runtime).
const OCR_FILE_TRACING_INCLUDES = [
  "./node_modules/pdfjs-dist/legacy/build/**",
  "./node_modules/@napi-rs/canvas*/**",
  "./node_modules/tesseract.js/src/**",
  "./node_modules/tesseract.js-core/**",
  "./node_modules/bmp-js/**",
  "./node_modules/idb-keyval/**",
  "./node_modules/is-url/**",
  "./node_modules/node-fetch/**",
  "./node_modules/whatwg-url/**",
  "./node_modules/tr46/**",
  "./node_modules/webidl-conversions/**",
  "./node_modules/regenerator-runtime/**",
  "./node_modules/wasm-feature-detect/**",
  "./node_modules/zlibjs/**",
];

const nextConfig: NextConfig = {
  // Tells Next.js to leave these un-bundled on the server so Node's normal
  // module resolution handles them instead of webpack/Turbopack rewriting
  // their internal path lookups.
  serverExternalPackages: ["tesseract.js", "pdf-parse", "@napi-rs/canvas"],

  outputFileTracingIncludes: {
    "/api/ai/extract": OCR_FILE_TRACING_INCLUDES,
    "/api/parse-order": OCR_FILE_TRACING_INCLUDES,
    "/api/documents/[documentId]/extract-text": OCR_FILE_TRACING_INCLUDES,
  },
};

export default nextConfig;
