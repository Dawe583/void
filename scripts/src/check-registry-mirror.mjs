/**
 * Fails when the site's copy of the registry has drifted from this one.
 *
 * The registry is the product's core and the site's most valuable content at the
 * same time, so it exists in two repositories: canonically here, and mirrored in
 * the site repository as api/_registry.ts so its Vercel build never has to reach
 * a second repository. A mirror is only safe while something proves it is still
 * a mirror, and that is this script.
 *
 * It compares everything below the file header, because the two copies carry
 * different header comments on purpose: one explains why the package depends on
 * nothing, the other tells an editor to stop and edit this one instead.
 *
 * At WP-15 the product publishes @void/registry to npm, the site imports a bare
 * specifier, and both this script and the mirror it guards are deleted.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..", "..");
const canonical = join(root, "packages", "registry", "src", "registry.ts");

const sitePath =
  process.env.VOID_SITE_REPO ??
  [join(root, "..", "void-empty"), join(root, "..", "void-site")].find((d) => existsSync(d));

if (!sitePath) {
  console.log("  site repository not checked out, mirror not compared");
  console.log("  clone it beside this one, or set VOID_SITE_REPO, to enable the check");
  process.exit(0);
}

const mirror = join(sitePath, "api", "_registry.ts");
if (!existsSync(mirror)) {
  console.error(`  no mirror at ${mirror}`);
  process.exit(1);
}

/** Everything from the first export onward, which is the part that must match. */
function body(file) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf("export type RegistryTone");
  if (start < 0) throw new Error(`${file} does not look like the registry`);
  return text.slice(start).replace(/\r\n/g, "\n").trimEnd();
}

const a = body(canonical);
const b = body(mirror);
const digest = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

if (a === b) {
  console.log(`  registry mirror matches, sha256 ${digest(a)}, ${a.split("\n").length} lines`);
  process.exit(0);
}

console.error("  REGISTRY MIRROR HAS DRIFTED");
console.error(`    canonical ${canonical}  sha256 ${digest(a)}  ${a.split("\n").length} lines`);
console.error(`    mirror    ${mirror}  sha256 ${digest(b)}  ${b.split("\n").length} lines`);

const left = a.split("\n");
const right = b.split("\n");
for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
  if (left[i] !== right[i]) {
    console.error(`    first difference at body line ${i + 1}`);
    console.error(`      canonical: ${left[i] ?? "(end of file)"}`);
    console.error(`      mirror:    ${right[i] ?? "(end of file)"}`);
    break;
  }
}
console.error("    edit the canonical copy, then copy it over the mirror");
process.exit(1);
