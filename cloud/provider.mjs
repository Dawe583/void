import { getVercelOidcToken } from "@vercel/oidc";
import { CompatibleProvider } from "../packages/workbench/src/provider.ts";
import { read, decrypt } from "./store.mjs";
export async function provider(snapshot) {
  const config = snapshot ?? (await read("provider"));
  if (config?.disabled) throw new Error("Connect a provider first.");
  return new CompatibleProvider(
    config?.secret
      ? decrypt(config.secret)
      : {
          baseUrl: "https://ai-gateway.vercel.sh/v1",
          apiKey:
            process.env.AI_GATEWAY_API_KEY ?? (await getVercelOidcToken()),
        },
  );
}
export async function providerState() {
  try {
    const client = await provider();
    const models = await client.models();
    return {
      connected: true,
      models,
      keyStorage: "encrypted-cloud",
      mode: (await read("provider"))?.secret ? "custom" : "vercel-gateway",
    };
  } catch {
    return {
      connected: false,
      models: [],
      keyStorage: "encrypted-cloud",
      message: "Connect a provider or enable Vercel AI Gateway.",
    };
  }
}
