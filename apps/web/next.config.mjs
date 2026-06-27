import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for a small, self-contained runtime image.
  output: "standalone",
  // Trace files from the monorepo root so the workspace dependency
  // (@clasher/shared) is included in the standalone bundle.
  outputFileTracingRoot: path.join(dirname, "../../"),
  transpilePackages: ["@clasher/shared"],
};

export default nextConfig;
