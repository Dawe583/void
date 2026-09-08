import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { devKeyProvider } from "../../ledger/src/sign.ts";
import { readLedgerEntries, verifyChain } from "../../ledger/src/verify.ts";
import { verifyAttestation } from "../../ledger/src/attest.ts";
import type { AttestationDocument } from "../../ledger/src/attest.ts";
import type { PublicKeyLookup } from "../../ledger/src/verify.ts";

export type VerifyCommandIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
};

export type VerifyCommandOptions = {
  readonly publicKey?: PublicKeyLookup;
};

type VerifyArgs = {
  readonly ledger: string | undefined;
  readonly file: string | undefined;
  readonly attestation: string | undefined;
  readonly key: string | undefined;
};

const USAGE = "usage: void verify --ledger <dir-or-file> [--file export.jsonl] [--attestation path] [--key base64-spki]";

export async function runVerifyCommand(
  argv: readonly string[],
  io: VerifyCommandIo,
  options: VerifyCommandOptions = {},
): Promise<number> {
  try {
    const parsed = parseVerifyArgs(argv);
    const ledgerPath = await resolveLedgerPath(parsed, io.env ?? process.env);
    const publicKey = options.publicKey ?? await publicKeyLookup(parsed.key, io.env ?? process.env);
    const entries = await readLedgerEntries(ledgerPath);
    const chain = await verifyChain(entries, { publicKey });
    for (const line of chain.lines) {
      io.stdout(line.ok ? `seq ${line.seq}: ok` : `seq ${line.seq}: fail ${line.reason}`);
    }
    if (!chain.ok) {
      io.stderr(`void verify failed: ${chain.reason}`);
      return 1;
    }
    io.stdout(`chain: ${chain.checked} entries ok`);

    if (parsed.attestation === undefined) {
      io.stdout("attestation: not checked");
      return 0;
    }

    const doc = parseAttestation(await readFile(parsed.attestation, "utf8"));
    const attestation = await verifyAttestation(doc, entries, { publicKey });
    if (!attestation.ok) {
      io.stdout(`attestation: mismatch ${attestation.reason}`);
      return 1;
    }
    io.stdout("attestation: match");
    return 0;
  } catch (error) {
    io.stderr(`void verify failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  let ledger: string | undefined;
  let file: string | undefined;
  let attestation: string | undefined;
  let key: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--ledger") {
      ledger = needValue(argv, index, "--ledger");
      index += 1;
    } else if (arg === "--file") {
      file = needValue(argv, index, "--file");
      index += 1;
    } else if (arg === "--attestation") {
      attestation = needValue(argv, index, "--attestation");
      index += 1;
    } else if (arg === "--key") {
      key = needValue(argv, index, "--key");
      index += 1;
    } else {
      throw new Error(`unknown verify option ${JSON.stringify(arg)}. ${USAGE}`);
    }
  }
  return { ledger, file, attestation, key };
}

function needValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (value === undefined || value === "") throw new Error(`${name} needs a value`);
  return value;
}

async function resolveLedgerPath(
  args: VerifyArgs,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<string> {
  if (args.file !== undefined) return args.file;
  const path = args.ledger ?? join(env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger"), `${env.VOID_WORKSPACE ?? "default"}.jsonl`);
  try {
    const info = await stat(path);
    if (info.isDirectory()) return join(path, `${env.VOID_WORKSPACE ?? "default"}.jsonl`);
  } catch {
    return path;
  }
  return path;
}

async function publicKeyLookup(
  key: string | undefined,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<PublicKeyLookup> {
  if (key !== undefined) return new Uint8Array(Buffer.from(key, "base64"));
  const provider = await devKeyProvider({ env });
  return (keyId) => provider.publicKey(keyId);
}

function parseAttestation(text: string): AttestationDocument {
  const parsed = JSON.parse(text) as Partial<AttestationDocument>;
  if (typeof parsed.workspace !== "string" || parsed.workspace === "")
    throw new Error("attestation has invalid workspace");
  if (typeof parsed.headSeq !== "number" || !Number.isInteger(parsed.headSeq) || parsed.headSeq < 0)
    throw new Error("attestation has invalid headSeq");
  if (typeof parsed.headHash !== "string" || parsed.headHash === "")
    throw new Error("attestation has invalid headHash");
  if (typeof parsed.at !== "string" || parsed.at === "")
    throw new Error("attestation has invalid at");
  if (typeof parsed.entriesCount !== "number" || !Number.isInteger(parsed.entriesCount) || parsed.entriesCount < 0)
    throw new Error("attestation has invalid entriesCount");
  if (typeof parsed.treeDigest !== "string" || parsed.treeDigest === "")
    throw new Error("attestation has invalid treeDigest");
  if (typeof parsed.key_id !== "string" || parsed.key_id === "")
    throw new Error("attestation has invalid key_id");
  if (parsed.alg !== "ed25519" && parsed.alg !== "ecdsa-p256-sha256")
    throw new Error("attestation has invalid alg");
  if (typeof parsed.signature !== "string" || parsed.signature === "")
    throw new Error("attestation has invalid signature");
  return parsed as AttestationDocument;
}
