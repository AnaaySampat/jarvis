import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createManifest, verifyPublishedOrder, signerDigest } from "./build-android-update.mjs";
const config = { version: "2.5.6-rc.2", bundle: { android: { versionCode: 2005007 } } };
const notes = { versionName: config.version, title: "Updates", features: [{ id: "popup", title: "New popup" }], fixes: [] };
const inspected = { versionName: config.version, versionCode: 2005007, packageId: "com.jarvis.app", minSdk: 24, arm64: true };
test("release manifest binds authored features to verified APK bytes and identity", () => {
  const apk = Buffer.from("test apk");
  const result = createManifest(config, notes, apk, inspected);
  assert.equal(result.channel, "beta");
  assert.equal(result.assets[0].sha256, createHash("sha256").update(apk).digest("hex"));
  assert.equal(result.assets[0].size, apk.length);
  assert.equal(result.features.length, 1);
  assert.match(result.assets[0].url, /v2\.5\.6-rc\.2\/JARVIS-v2\.5\.6-rc\.2-arm64\.apk$/);
});
test("incorrect APK identity, version, ABI and absent explicit build code block publishing", () => {
  for (const change of [{ packageId: "com.other.app" }, { versionCode: 1 }, { versionName: "2.5.0" }, { arm64: false }, { minSdk: 26 }]) {
    assert.throws(() => createManifest(config, notes, Buffer.from("apk"), { ...inspected, ...change }));
  }
  assert.throws(() => createManifest({ version: config.version }, notes, Buffer.from("apk"), inspected));
});
test("duplicate feature IDs and mismatched release notes block publishing", () => {
  assert.throws(() => createManifest(config, { ...notes, features: [...notes.features, ...notes.features] }, Buffer.from("apk"), inspected));
  assert.throws(() => createManifest(config, { ...notes, versionName: "2.5.0" }, Buffer.from("apk"), inspected));
});
test("build numbers exceed legacy APKs and explicit published RC codes", async () => {
  const releases = [{ tag_name: "v2.5.6-rc.1", assets: [{ name: "android-update.json", browser_download_url: "https://github.com/AnaaySampat/jarvis/releases/download/v2.5.6-rc.1/android-update.json" }] }];
  const get = async (url) => url.startsWith("https://api.github.com/") ? releases : { versionCode: 2005008 };
  await assert.rejects(verifyPublishedOrder({ versionCode: 2005007 }, get), /must exceed/);
  await verifyPublishedOrder({ versionCode: 2005009 }, get);
  await assert.rejects(verifyPublishedOrder({ versionCode: 2005006 }, async () => [{ tag_name: "v2.5.6-rc.1", assets: [] }]), /must exceed/);
});
test("publishing chooses a trusted APK as the signing anchor and requires a verified signer", async () => {
  const url = "https://github.com/AnaaySampat/jarvis/releases/download/v2.5.0/JARVIS-v2.5.0-arm64.apk";
  const result = await verifyPublishedOrder({ versionCode: 2005007 }, async () => [{ tag_name: "v2.5.0", assets: [{ name: "JARVIS-v2.5.0-arm64.apk", browser_download_url: url }] }]);
  assert.equal(result, url);
  assert.equal(signerDigest(`Signer #1 certificate SHA-256 digest: ${"a".repeat(64)}`), "a".repeat(64));
  assert.throws(() => signerDigest("Unsigned APK"));
  await assert.rejects(verifyPublishedOrder({ versionCode: 2005007 }, async () => [{ tag_name: "v2.5.0", assets: [{ name: "update.apk", browser_download_url: "https://example.com/app.apk" }] }]), /Untrusted/);
});
