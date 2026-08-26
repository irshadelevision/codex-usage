import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const scriptDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const projectDirectory = NodePath.resolve(scriptDirectory, "..");
const releaseDirectory = NodePath.resolve(projectDirectory, "release");

if (NodePath.dirname(releaseDirectory) !== projectDirectory) {
  throw new Error(`Refusing to clean unexpected release path: ${releaseDirectory}`);
}

await NodeFSP.rm(releaseDirectory, { recursive: true, force: true });
