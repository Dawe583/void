import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPolicy } from "./rules.ts";
import type { LoadedPolicy } from "./rules.ts";

const PACK_NAMES: readonly string[] = Object.freeze(["strict", "balanced", "dev"]);

export class PackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PackError";
  }
}

export function listPacks(): readonly string[] {
  return PACK_NAMES;
}

export async function loadPack(
  name: string,
  dir: string = fileURLToPath(new URL("../packs/", import.meta.url)),
): Promise<Extract<LoadedPolicy, { readonly ok: true }>> {
  if (!PACK_NAMES.includes(name)) throw new PackError("Unknown policy pack name");
  try {
    const loaded = loadPolicy(await readFile(join(dir, `${name}.yaml`), "utf8"));
    if (!loaded.ok) throw new PackError(`Invalid policy pack ${name}`);
    return loaded;
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError(`Cannot load policy pack ${name}`, { cause: error });
  }
}
