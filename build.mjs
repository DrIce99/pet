// Bundles main, preload and renderer with esbuild. Type checking is separate
// (`npm run typecheck`) because esbuild only strips types.
import { build } from "esbuild";
import { cp, readdir, rm } from "node:fs/promises";

const withTests = process.argv.includes("--tests");
const common = { bundle: true, sourcemap: true, target: "es2023", logLevel: "warning" };

await rm("dist", { recursive: true, force: true });

const jobs = [
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main/main.js",
    platform: "node",
    format: "cjs",
    // node_modules (electron, @anthropic-ai/sdk) are resolved at runtime
    packages: "external",
  }),
  build({
    ...common,
    entryPoints: ["src/preload/pet.ts", "src/preload/settings.ts"],
    outdir: "dist/preload",
    platform: "node",
    format: "cjs",
    // sandboxed preloads may only require("electron")
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/pet.ts", "src/renderer/settings.ts"],
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
  }),
];

if (withTests) {
  const testFiles = (await readdir("test")).filter((f) => f.endsWith(".test.ts"));
  jobs.push(
    build({
      ...common,
      entryPoints: testFiles.map((f) => `test/${f}`),
      outdir: "dist/test",
      platform: "node",
      format: "cjs",
      packages: "external",
    }),
  );
}

await Promise.all(jobs);

for (const file of ["pet.html", "pet.css", "settings.html", "settings.css"]) {
  await cp(`src/renderer/${file}`, `dist/renderer/${file}`);
}
