import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const widgetDirectory = path.dirname(fileURLToPath(import.meta.url));
const outfile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(widgetDirectory, "../dist/widget.js");

await build({
  entryPoints: [path.join(widgetDirectory, "index.tsx")],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
});
