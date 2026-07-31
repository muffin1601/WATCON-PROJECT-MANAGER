import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js and pdf-parse (which wraps pdf.js) both resolve worker
  // scripts via runtime path lookups against real node_modules paths —
  // Turbopack/webpack bundling rewrites those paths and breaks them
  // ("Cannot find module '...worker-script/node/index.js'" /
  //  "Setting up fake worker failed: Cannot find module '...pdf.worker.mjs'").
  // serverExternalPackages tells Next.js to leave them un-bundled on the
  // server so Node's normal module resolution handles them.
  serverExternalPackages: ["tesseract.js", "pdf-parse"],
};

export default nextConfig;
