import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export default async function ensureMacosBundleSignature(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = NodePath.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  await execFileAsync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
  await execFileAsync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
}
