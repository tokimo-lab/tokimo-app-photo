#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(scriptDir, "..");
const appDir = resolve(uiDir, "..");
const repoRoot = resolve(appDir, "../..");
const wasmDir = join(repoRoot, "packages/tokimo-app-photo-wasm");
const pkgDir = join(wasmDir, "pkg");
const generatedDir = join(uiDir, "src/wasm/generated");
const publicWasmDir = join(uiDir, "public/wasm");

const requiredGenerated = [
  join(generatedDir, "tokimo_app_photo_wasm.js"),
  join(generatedDir, "tokimo_app_photo_wasm.d.ts"),
  join(publicWasmDir, "tokimo_app_photo_wasm_bg.wasm"),
];

const dev = process.argv.includes("--dev");
const profileArg = dev ? "--dev" : "--release";

function generatedAssetsExist(): boolean {
  return requiredGenerated.every((path) => existsSync(path));
}

function run(cmd: string[], cwd: string) {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${proc.exitCode}`);
  }
}

async function main() {
  if (!existsSync(wasmDir)) {
    if (generatedAssetsExist()) return;
    throw new Error(
      "missing generated Photo WASM assets and monorepo package packages/tokimo-app-photo-wasm",
    );
  }

  await rm(pkgDir, { recursive: true, force: true });
  run(
    ["wasm-pack", "build", profileArg, "--target", "web", "--out-dir", "pkg"],
    wasmDir,
  );

  await rm(generatedDir, { recursive: true, force: true });
  await rm(publicWasmDir, { recursive: true, force: true });
  await mkdir(generatedDir, { recursive: true });
  await mkdir(publicWasmDir, { recursive: true });

  for (const file of [
    "tokimo_app_photo_wasm.js",
    "tokimo_app_photo_wasm.d.ts",
  ]) {
    await cp(join(pkgDir, file), join(generatedDir, file));
  }

  const generatedJs = join(generatedDir, "tokimo_app_photo_wasm.js");
  const generatedSource = await Bun.file(generatedJs).text();
  await Bun.write(
    generatedJs,
    generatedSource.replace(
      "new URL('tokimo_app_photo_wasm_bg.wasm', import.meta.url)",
      "new URL(/* @vite-ignore */ 'tokimo_app_photo_wasm_bg.wasm', import.meta.url)",
    ),
  );

  const wasmFile = "tokimo_app_photo_wasm_bg.wasm";
  await cp(join(pkgDir, wasmFile), join(publicWasmDir, wasmFile));

  const wasmTypes = "tokimo_app_photo_wasm_bg.wasm.d.ts";
  if (existsSync(join(pkgDir, wasmTypes))) {
    await cp(join(pkgDir, wasmTypes), join(generatedDir, wasmTypes));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
