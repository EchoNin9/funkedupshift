#!/usr/bin/env node
/**
 * Self-hosts the @imgly/background-removal model + onnxruntime-wasm assets.
 *
 * The npm package ships NO binaries (dist/resources.json in the package is
 * `{}`) — the actual .wasm/.onnx files live on IMG.LY's own CDN, versioned
 * to match the installed package version exactly:
 *   https://staticimgly.com/@imgly/background-removal-data/<version>/dist/
 * That CDN is also the library's *default* `publicPath`, i.e. where the
 * browser would fetch from at runtime if we did nothing. This script runs
 * at build time (prebuild, like the amazon-cognito-identity-js copy below)
 * to pull down only the handful of files RemoveBgPage actually needs
 * (wasm runtime + the "small"/isnet_quint8 model — see RemoveBgPage.tsx for
 * why "small") and drop them into public/imgly/, which vite then copies
 * into dist/ verbatim. At runtime the browser only ever talks to our own
 * origin (config.publicPath = `${location.origin}/imgly/`) — never the
 * IMG.LY CDN. Raw binaries are gitignored (public/.gitignore); CI re-fetches
 * them on every `npm run build`, same as it does `npm ci`.
 *
 * Duplicated verbatim in the tools-site app's scripts/ — the two frontends
 * deliberately don't import from each other (see the note atop
 * src/web/tools-site/src/api.ts).
 */
const fs = require("fs");
const path = require("path");

const PKG_DIR = path.join(__dirname, "..", "node_modules", "@imgly", "background-removal");
const OUT_DIR = path.join(__dirname, "..", "public", "imgly");

// Keep in sync with the `model` / `device` passed to removeBackground() in
// RemoveBgPage.tsx — only the resource keys actually requested at runtime
// need to exist locally.
const RESOURCE_KEYS = [
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/models/isnet_quint8",
];

// staticimgly.com is a single external host with no fallback — a transient
// blip here would otherwise fail an entire CI deploy over a file we already
// have cached most of the time. Small retry buys real resilience for free.
async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  const version = pkgJson.version;
  const base = `https://staticimgly.com/@imgly/background-removal-data/${version}/dist/`;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifestRes = await fetchWithRetry(new URL("resources.json", base));
  const manifest = await manifestRes.json();

  const trimmed = {};
  let totalBytes = 0;
  let fetchedFiles = 0;

  for (const key of RESOURCE_KEYS) {
    const entry = manifest[key];
    if (!entry) throw new Error(`Resource ${key} missing from upstream manifest at ${base}`);
    trimmed[key] = entry;
    totalBytes += entry.size;

    for (const chunk of entry.chunks) {
      const outPath = path.join(OUT_DIR, chunk.name);
      const expectedSize = chunk.offsets[1] - chunk.offsets[0];
      if (fs.existsSync(outPath) && fs.statSync(outPath).size === expectedSize) {
        continue; // already fetched (local dev re-run)
      }
      const chunkRes = await fetchWithRetry(new URL(chunk.name, base));
      const buf = Buffer.from(await chunkRes.arrayBuffer());
      if (buf.length !== expectedSize) {
        throw new Error(`Chunk ${chunk.name} for ${key}: expected ${expectedSize} bytes, got ${buf.length}`);
      }
      fs.writeFileSync(outPath, buf);
      fetchedFiles++;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "resources.json"), JSON.stringify(trimmed));

  console.log(
    `[fetch-imgly-assets] ${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${RESOURCE_KEYS.length} resources ` +
      `(${fetchedFiles} chunk file(s) fetched, rest already present) -> ${path.relative(process.cwd(), OUT_DIR)}`
  );
}

main().catch((err) => {
  console.error("[fetch-imgly-assets] failed:", err.message);
  process.exit(1);
});
