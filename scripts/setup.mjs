#!/usr/bin/env node
/**
 * One-step installer, same on Windows, macOS and Linux:
 *   node scripts/setup.mjs            check prerequisites, install dependencies, build
 *   node scripts/setup.mjs --check    check prerequisites only
 * Started by install.sh / install.bat. Uses only Node built-ins, so it runs
 * before any dependency is installed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const checkOnly = process.argv.includes("--check");
const MIN_NODE = [22, 6];

function fail(message) {
  console.error(`\nSetup stopped: ${message}`);
  process.exit(1);
}

// 1. Node version
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  fail(`Node.js ${MIN_NODE.join(".")} or later is required (found ${process.versions.node}). Get it from https://nodejs.org/en/download`);
}
console.log(`Node.js ${process.versions.node}: OK`);

// 2. A Chromium-based browser for PDF export (Chrome, Chromium or Edge)
const candidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  ...JSON.parse(fs.readFileSync(path.join(root, "src", "lib", "browser-paths.json"), "utf8")),
].filter(Boolean);
const browser = candidates.find((p) => fs.existsSync(p));
if (browser) console.log(`Browser for PDF export: ${browser}`);
else {
  console.warn(
    "Browser for PDF export: none found. The app will run, but PDF export needs Chrome, Chromium or Edge.\n" +
      "  Install one, or set CHROME_PATH to its program file before starting the app.",
  );
}
if (checkOnly) process.exit(0);

// 3. Dependencies and build
function run(args) {
  console.log(`\n> npm ${args.join(" ")}`);
  // npm is npm.cmd on Windows, which needs a shell
  const res = spawnSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.error) fail(`could not run npm (${res.error.message}). npm is installed together with Node.js.`);
  if (res.status !== 0) fail(`"npm ${args.join(" ")}" failed with exit code ${res.status}.`);
}
run(["ci", "--no-audit", "--no-fund"]);
run(["run", "build"]);

const win = process.platform === "win32";
console.log(
  `\nInstalled. Start it with ${win ? "start.bat" : "./start.sh"} (or "npm start"), then open http://127.0.0.1:3000\n` +
    "It listens on this computer only and has no login.",
);
