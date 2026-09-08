import { readLedgerFeed, watchLedgerFeed, type FeedPage, type LedgerFeedWatch } from "../../ledger/src/feed.ts";
import { homedir } from "node:os";
import { join } from "node:path";

export type FeedCommandIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
};

export type FeedCommandOptions = {
  readonly readFeed?: typeof readLedgerFeed;
  readonly watchFeed?: typeof watchLedgerFeed;
};

export async function runFeedCommand(
  argv: readonly string[],
  io: FeedCommandIo,
  options: FeedCommandOptions = {},
): Promise<number> {
  const parsed = parseFeedArgs(argv, io.env ?? process.env);
  const readFeed = options.readFeed ?? readLedgerFeed;
  const watchFeed = options.watchFeed ?? watchLedgerFeed;
  try {
    const page = await readFeed(parsed.ledger);
    let lastPrinted = printPage(page, parsed.json, io.stdout, 0, parsed.follow);
    if (!parsed.follow) return 0;
    activeWatch = watchFeed(parsed.ledger, (next) => {
      lastPrinted = printPage(next, parsed.json, io.stdout, lastPrinted, true);
    });
    return 0;
  } catch (error) {
    io.stderr(`void feed failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

let activeWatch: LedgerFeedWatch | null = null;

export function closeActiveFeedWatch(): void {
  activeWatch?.close();
  activeWatch = null;
}

type FeedArgs = {
  readonly ledger: string;
  readonly follow: boolean;
  readonly json: boolean;
};

function parseFeedArgs(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv>): FeedArgs {
  let ledger: string | undefined;
  let follow = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--ledger") {
      ledger = argv[index + 1];
      if (ledger === undefined || ledger === "") throw new Error("--ledger needs a path");
      index += 1;
    } else if (arg === "--follow") {
      follow = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown feed option ${JSON.stringify(arg)}`);
    }
  }
  return { ledger: ledger ?? defaultLedgerPath(env), follow, json };
}

function defaultLedgerPath(env: Readonly<NodeJS.ProcessEnv>): string {
  const dir = env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger");
  const workspace = env.VOID_WORKSPACE ?? "default";
  return join(dir, `${workspace}.jsonl`);
}

function printPage(
  page: FeedPage,
  json: boolean,
  stdout: (line: string) => void,
  afterSeq: number,
  follow: boolean,
): number {
  const records = page.records.filter((record) => record.seq > afterSeq);
  if (json) {
    if (follow) {
      for (const record of records) stdout(JSON.stringify(record));
    } else {
      stdout(JSON.stringify({ ...page, records }));
    }
  } else {
    if (!follow || afterSeq === 0) stdout("seq at tool klass decision argsDigest digest");
    for (const record of records) {
      stdout([
        record.seq,
        record.at,
        record.tool,
        record.klass,
        record.decision,
        record.argsDigest,
        record.digest,
      ].join(" "));
    }
  }
  return records.length === 0 ? afterSeq : records[records.length - 1]!.seq;
}
