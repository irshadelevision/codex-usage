import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const appDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const devUrl = "http://127.0.0.1:4178";
const executableSuffix = NodeProcess.platform === "win32" ? ".cmd" : "";
const vpPath = NodePath.join(appDir, "node_modules", ".bin", `vp${executableSuffix}`);
const electronPath = NodePath.join(appDir, "node_modules", ".bin", `electron${executableSuffix}`);
const children = new Set();
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = NodeChildProcess.spawn(command, args, {
    cwd: appDir,
    stdio: "inherit",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = run(command, args);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? "unknown"}`));
    });
  });
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(devUrl);
      if (response.ok) return;
    } catch {
      // The renderer is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer did not start at ${devUrl}`);
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  NodeProcess.exit(code);
}

await runOnce(vpPath, ["pack"]);
const renderer = run(vpPath, ["dev", "--host", "127.0.0.1", "--port", "4178"]);
await waitForRenderer();
const desktop = run(electronPath, ["dist-electron/main.cjs"], {
  env: { ...NodeProcess.env, CODEX_USAGE_DEV_URL: devUrl },
});

renderer.once("exit", (code) => void shutdown(code ?? 1));
desktop.once("exit", (code) => void shutdown(code ?? 0));
NodeProcess.once("SIGINT", () => void shutdown(130));
NodeProcess.once("SIGTERM", () => void shutdown(143));
