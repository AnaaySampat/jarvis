import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(resolve(root, "jarvis-studio-gui/package.json"));
const Ajv = require("ajv");
const directory = resolve(root, "contracts/ecosystem-v1");
const bundle = JSON.parse(readFileSync(resolve(directory, "bundle.json")));
const fixtures = JSON.parse(readFileSync(resolve(directory, "golden.json")));
const lock = JSON.parse(readFileSync(resolve(directory, "manifest.json")));
if (bundle.version !== lock.version) throw new Error("Contract version differs from the pin");
for (const [file, checksum] of Object.entries(lock.sha256)) {
  const bytes = readFileSync(resolve(directory, file));
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error(`Contract pin mismatch: ${file}`);
  if (process.argv[2]) {
    const copy = readFileSync(resolve(process.argv[2], "contracts/ecosystem-v1", file));
    if (!bytes.equals(copy)) throw new Error(`Windows contract copy differs: ${file}`);
  }
}
const ajv = new Ajv({ allErrors: true });
for (const fixture of fixtures) {
  const validate = ajv.compile(bundle.schemas[fixture.schema]);
  if (validate(fixture.value) !== fixture.valid) throw new Error(`Golden fixture failed: ${fixture.schema} ${JSON.stringify(validate.errors)}`);
}
console.log(`Contract ${bundle.version}: ${fixtures.length} golden fixtures passed${process.argv[2] ? "; Windows copy matches" : ""}.`);
