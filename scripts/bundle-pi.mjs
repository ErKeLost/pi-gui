import { existsSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packageRoot = resolve(root, "node_modules/@earendil-works/pi-coding-agent");
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const output = resolve(root, "src-tauri/resources/pi-runtime");
const bun = process.env.ORBIT_BUN_PATH
  || (process.env.BUN_INSTALL ? resolve(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun") : "bun");
const marker = resolve(output, "package.json");
const current = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : null;
const buildFormat = 4;

const computerUse = spawnSync(process.execPath, [resolve(root, "scripts/sync-computer-use.mjs")], { cwd: root, stdio: "inherit" });
if (computerUse.status !== 0) process.exit(computerUse.status ?? 1);

if (current?.version === packageJson.version && current?.buildFormat === buildFormat && existsSync(resolve(output, "cli.js")) && existsSync(resolve(output, "index.js"))) process.exit(0);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const result = spawnSync(bun, [
  "build",
  resolve(packageRoot, "dist/cli.js"),
  resolve(packageRoot, "dist/index.js"),
  "--target=node",
  "--format=esm",
  "--splitting",
  `--outdir=${output}`,
  "--external=@silvia-odwyer/photon-node",
  "--define=PI_BUNDLED_NODE=true",
  "--sourcemap=none",
], { cwd: root, stdio: "inherit" });

if (result.error) console.error(`无法启动 Bun 打包 Pi runtime: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status ?? 1);

const themeSource = resolve(packageRoot, "dist/modes/interactive/theme");
const themeTarget = resolve(output, "dist/modes/interactive/theme");
mkdirSync(dirname(themeTarget), { recursive: true });
cpSync(themeSource, themeTarget, { recursive: true });

for (const relative of ["dist/core/export-html", "dist/modes/interactive/assets"]) {
  const source = resolve(packageRoot, relative);
  if (!existsSync(source)) continue;
  const target = resolve(output, relative);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

const photonSource = resolve(root, "node_modules/@silvia-odwyer/photon-node");
const photonTarget = resolve(output, "node_modules/@silvia-odwyer/photon-node");
mkdirSync(dirname(photonTarget), { recursive: true });
cpSync(photonSource, photonTarget, { recursive: true });

writeFileSync(marker, `${JSON.stringify({ name: "orbit-pi-runtime", private: true, type: "module", version: packageJson.version, buildFormat }, null, 2)}\n`);
