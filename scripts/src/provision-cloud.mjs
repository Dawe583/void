// Run with node --env-file=.env.local. Secrets are never printed.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { database } from "../../cloud/store.mjs";
await database().query(
  await readFile(new URL("../../cloud/schema.sql", import.meta.url), "utf8"),
);
let secrets;
try {
  secrets = JSON.parse(await readFile(".env.cloud-secrets", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  secrets = {
    VOID_CONTROL_TOKEN: randomBytes(32).toString("hex"),
    VOID_SECRET_KEY: randomBytes(32).toString("base64"),
    VOID_SIGNING_KEY: generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
  await writeFile(".env.cloud-secrets", JSON.stringify(secrets), {
    mode: 0o600,
  });
}
await writeFile(".env.void-access", secrets.VOID_CONTROL_TOKEN + "\n", {
  mode: 0o600,
});
for (const [name, value] of Object.entries(secrets))
  for (const env of ["production", "preview", "development"]) {
    const result = spawnSync(
      "npx",
      [
        "--yes",
        "vercel@59.16.0",
        "env",
        "add",
        name,
        env,
        "--scope",
        "sitespot",
        "--force",
      ],
      { input: value, encoding: "utf8" },
    );
    if (result.status !== 0)
      throw new Error(
        `Could not configure ${name} for ${env}: ${result.stderr.replaceAll(value, "[redacted]")}`,
      );
    console.log(`Configured ${name} for ${env}`);
  }
await database().end();
console.log("Cloud schema and server secrets ready.");
