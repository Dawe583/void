import { getVercelOidcToken } from "@vercel/oidc";
import { CompatibleProvider } from "../packages/workbench/src/provider.ts";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER_ID,
  TOKENROUTER_URL,
  PROVIDER_PRESETS,
} from "../packages/workbench/src/provider-defaults.ts";
import { read, decrypt } from "./store.mjs";

async function configuration(snapshot) {
  const config = snapshot ?? (await read("provider"));
  if (config?.disabled) throw new Error("Connect a provider first.");
  if (config?.secret) return decrypt(config.secret);
  // Explicit legacy snapshots retain their provider. New workspaces use TokenRouter.
  if (config?.mode === "gateway")
    return {
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      apiKey: process.env.AI_GATEWAY_API_KEY ?? (await getVercelOidcToken()),
      kind: "openai",
    };
  if (!process.env.TOKENROUTER_API_KEY)
    throw new Error("Connect TokenRouter to use GLM 5.3 Free.");
  return {
    baseUrl: TOKENROUTER_URL,
    apiKey: process.env.TOKENROUTER_API_KEY,
    kind: "openai",
  };
}
export async function provider(snapshot) {
  return new CompatibleProvider(await configuration(snapshot));
}
export async function providerState() {
  const defaults = {
    defaultModel: DEFAULT_MODEL_ID,
    providerId: DEFAULT_PROVIDER_ID,
    presets: PROVIDER_PRESETS.filter((p) => !("local" in p)),
    keyStorage: "encrypted-cloud",
  };
  try {
    const config = await configuration();
    const models = await new CompatibleProvider(config).models();
    return {
      ...defaults,
      connected: true,
      baseUrl: config.baseUrl,
      kind: config.kind,
      providerId:
        PROVIDER_PRESETS.find((p) => p.baseUrl === config.baseUrl)?.id ??
        "custom",
      profiles: Object.keys((await read("provider-profiles")) ?? {}),
      models,
      mode: config.baseUrl === TOKENROUTER_URL ? "tokenrouter" : "custom",
    };
  } catch (error) {
    return {
      ...defaults,
      connected: false,
      baseUrl: TOKENROUTER_URL,
      models: [],
      message:
        error instanceof Error
          ? error.message
          : "Connect TokenRouter to continue.",
    };
  }
}
