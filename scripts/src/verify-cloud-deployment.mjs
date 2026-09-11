// Authenticated deployment smoke test. Never prints the workspace token.
import { readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const secrets = JSON.parse(await readFile(".env.cloud-secrets", "utf8"));
const url = process.argv[2];
if (!url?.startsWith("https://void-"))
  throw new Error("Supply the exact VOID deployment URL.");
await writeFile(
  ".env.curl-auth",
  `Authorization: Bearer ${secrets.VOID_CONTROL_TOKEN}\n`,
  { mode: 0o600 },
);
function request(path, body) {
  const args = [
    "--yes",
    "vercel@59.16.0",
    "curl",
    url + path,
    "--scope",
    "sitespot",
    "--",
    "-sS",
    "-H",
    "@.env.curl-auth",
  ];
  if (body)
    args.push(
      "-H",
      "content-type: application/json",
      "-d",
      JSON.stringify(body),
    );
  const result = spawnSync("npx", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Request failed for ${path}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Non-JSON response for ${path}: ${result.stdout.slice(0, 150)}`,
    );
  }
}
try {
  const state = request("/api/provider");
  console.log(
    JSON.stringify({
      providerConnected: state.connected,
      models: state.models?.length,
      error: state.error,
    }),
  );
  if (process.argv[3] === "run") {
    const model =
      state.models.find((m) => m.id === "openai/gpt-5.4-nano") ??
      state.models.find((m) => m.id === "openai/gpt-5-mini") ??
      state.models.find((m) => m.id.includes("flash-lite"));
    if (!model) throw new Error("No suitable small test model found.");
    const result = request("/api/sessions", {
      prompt: "Reply with exactly: VOID cloud ready. Do not call any tools.",
      model: model.id,
    });
    if (!result.session) throw new Error(JSON.stringify(result));
    await writeFile(".env.cloud-qa-id", result.session.id, { mode: 0o600 });
    console.log(
      JSON.stringify({
        started: result.session.id,
        model: model.id,
        status: result.session.status,
      }),
    );
  } else if (process.argv[3] === "status") {
    const id = await readFile(".env.cloud-qa-id", "utf8");
    const result = request("/api/sessions/" + id);
    console.log(JSON.stringify(result));
  } else console.log(JSON.stringify(request("/api/ledger/verify")));
} finally {
  await rm(".env.curl-auth", { force: true });
}
