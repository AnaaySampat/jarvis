import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, createWriteStream, unlinkSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = "https://github.com/AnaaySampat/jarvis";

export async function verifyPublishedOrder(manifest, getJson) {
  let signingAnchor = null;
  for (let page = 1; ; page++) {
    const releases = await getJson(`https://api.github.com/repos/AnaaySampat/jarvis/releases?per_page=100&page=${page}`);
    for (const release of releases.filter((item) => !item.draft)) {
      const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?$/.exec(release.tag_name || "");
      if (!match) continue;
      const apk = (release.assets || []).find((item) => item.name?.endsWith(".apk") && !/unsigned|debug/i.test(item.name));
      if (!signingAnchor && apk) {
        if (!apk.browser_download_url.startsWith(`${repo}/releases/download/${release.tag_name}/`) || apk.browser_download_url.includes("..")) throw new Error("Untrusted published APK URL");
        signingAnchor = apk.browser_download_url;
      }
      let code = Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3]);
      const asset = (release.assets || []).find((item) => item.name === "android-update.json");
      if (asset) {
        const expected = `${repo}/releases/download/${release.tag_name}/android-update.json`;
        if (asset.browser_download_url !== expected) throw new Error("Untrusted published update metadata URL");
        const previous = await getJson(expected);
        if (!Number.isInteger(previous.versionCode) || previous.versionCode < 1) throw new Error("Invalid published Android build code");
        code = previous.versionCode;
      }
      if (manifest.versionCode <= code) throw new Error(`Android build ${manifest.versionCode} must exceed published ${release.tag_name} build ${code}`);
    }
    if (releases.length < 100) break;
  }
  return signingAnchor;
}

export function signerDigest(output) {
  const matches = [...output.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})/gi)];
  if (matches.length !== 1) throw new Error("Expected exactly one verified APK signing certificate");
  return matches[0][1].toLowerCase();
}

export function createManifest(config, notes, apk, inspected) {
  const version = config.version;
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid release version");
  const versionCode = config.bundle?.android?.versionCode;
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error("Set an explicit Android versionCode");
  if (inspected.packageId !== "com.jarvis.app" || inspected.versionName !== version || inspected.versionCode !== versionCode || inspected.minSdk !== 24 || !inspected.arm64) throw new Error("Built APK does not match release configuration");
  if (notes.versionName !== version || !notes.title || notes.title.length > 180) throw new Error("Missing or mismatched release notes");
  for (const key of ["features", "fixes"]) {
    const rows = notes[key];
    if (!Array.isArray(rows) || rows.length > 100) throw new Error(`Invalid ${key}`);
    const ids = new Set();
    for (const row of rows) {
      if (!row.id || row.id.length > 100 || ids.has(row.id) || !row.title || row.title.length > 180 || (row.description || "").length > 1000) throw new Error(`Invalid ${key} highlight`);
      ids.add(row.id);
    }
  }
  if (!apk.length) throw new Error("Empty APK");
  return {
    schemaVersion: 1, versionName: version, versionCode,
    channel: version.includes("-") ? "beta" : "stable", packageId: "com.jarvis.app", minSdk: inspected.minSdk,
    publishedAt: new Date().toISOString(), title: notes.title, features: notes.features, fixes: notes.fixes,
    assets: [{ abi: "arm64-v8a", url: `${repo}/releases/download/v${version}/JARVIS-v${version}-arm64.apk`, size: apk.length, sha256: createHash("sha256").update(apk).digest("hex") }],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apkPath = resolve(process.argv[2] || "missing.apk");
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME must point at the Android SDK");
  const buildTools = readdirSync(join(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
  const run = (args) => execFileSync(java, args, { encoding: "utf8" }).trim();
  const signer = (path) => signerDigest(run(["-jar", join(sdk, "build-tools", buildTools, "lib", "apksigner.jar"), "verify", "--print-certs", path]));
  const currentSigner = signer(apkPath);
  const tools = join(sdk, "cmdline-tools", "latest");
  const analyze = (args) => run([`-Dcom.android.sdklib.toolsdir=${tools}`, "-classpath", join(tools, "lib", "apkanalyzer-classpath.jar"), "com.android.tools.apk.analyzer.ApkAnalyzerCli", ...args, apkPath]);
  const inspect = (field) => analyze(["manifest", field]);
  const config = JSON.parse(readFileSync(join(root, "jarvis-studio-gui/src-tauri/tauri.conf.json"), "utf8"));
  const notes = JSON.parse(readFileSync(join(root, `docs/releases/v${config.version}.json`), "utf8"));
  const inspected = { packageId: inspect("application-id"), versionName: inspect("version-name"), versionCode: Number(inspect("version-code")), minSdk: Number(inspect("min-sdk")), arm64: analyze(["files", "list"]).includes("/lib/arm64-v8a/") };
  const manifest = createManifest(config, notes, readFileSync(apkPath), inspected);
  if (process.env.PUBLISH === "true") {
    const anchor = await verifyPublishedOrder(manifest, async (url) => {
      const response = await fetch(url, { headers: { "User-Agent": "JARVIS-release" }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Cannot verify published build numbers: HTTP ${response.status}`);
      return response.json();
    });
    if (anchor) {
      const previous = `${apkPath}.previous-check.apk`;
      let created = false;
      try {
        const response = await fetch(anchor, { signal: AbortSignal.timeout(180000) });
        if (!response.ok || !response.body) throw new Error("Cannot verify the previously published signing key");
        let size = 0;
        const bounded = new Transform({ transform(chunk, _encoding, callback) {
          size += chunk.length;
          callback(size > 2000000000 ? new Error("Published APK exceeds the size limit") : null, chunk);
        } });
        const output = createWriteStream(previous, { flags: "wx" });
        output.once("open", () => { created = true; });
        await pipeline(Readable.fromWeb(response.body), bounded, output);
        if (signer(previous) !== currentSigner) throw new Error("The release signing key differs from the published app. Nothing will be published.");
      } finally { if (created) unlinkSync(previous); }
    }
  }
  writeFileSync(resolve(process.argv[3] || "android-update.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Verified update metadata for ${manifest.versionName}, build ${manifest.versionCode}`);
}
