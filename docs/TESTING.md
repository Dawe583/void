# VOID testing

This repository uses Node's built in test runner only. Tests import from `node:test` and `node:assert/strict`. Do not add test dependencies and do not use loose `node:assert`.

## Package test commands

Run package tests from the repository root with these exact commands:

```sh
cd packages/registry && node --test src/evaluate.test.ts src/facts.test.ts src/index.test.ts
cd packages/ledger && node --test src/index.test.ts
cd packages/proxy && node --test src/forward/forward.test.ts src/forward/tools.test.ts src/index.test.ts src/relay/notifications.test.ts src/relay/requests.test.ts src/session.test.ts src/transport/stdio.test.ts
cd packages/policy && node --test src/channels/cli.test.ts src/channels/slack.test.ts src/hold.test.ts src/index.test.ts src/rules.test.ts src/skeptics.test.ts
cd packages/connectors && node --test src/index.test.ts
cd packages/cli && node --test src/classify.test.ts src/index.test.ts src/tui/tui.test.ts
```

## Typecheck commands

Run TypeScript checks per package:

```sh
cd packages/registry && CI=true npx tsc -p tsconfig.json
cd packages/ledger && CI=true npx tsc -p tsconfig.json
cd packages/proxy && CI=true npx tsc -p tsconfig.json
cd packages/policy && CI=true npx tsc -p tsconfig.json
cd packages/connectors && CI=true npx tsc -p tsconfig.json
cd packages/cli && CI=true npx tsc -p tsconfig.json
```

## Workspace wide loop

Use this when you are allowed to run every package test in order:

```python
from pathlib import Path
import subprocess

for package in sorted(Path("packages").iterdir()):
    tests = sorted(package.rglob("*.test.ts"))
    if not tests:
        continue
    args = ["node", "--test", *[str(path.relative_to(package)) for path in tests]]
    subprocess.run(args, cwd=package, check=True)
```

## Moment script

Run:

```sh
node scripts/src/moment.mjs
```

The script loads `policy/default.yaml`, classifies a sample `postgres.row.delete` as `r1`, and expects policy to hold the call. It creates one hold, renders the queue, cancels it through the CLI channel with `n`, confirms the row count is unchanged, and prints the message an agent would receive.

## Classify fixture

Run:

```sh
node packages/cli/bin/void.mjs classify --transcript fixtures/session.jsonl --facts fixtures/facts.json
```

This reads the fixture transcript and declared facts, then prints call counts by class and the unclassified rate.

## Adding a test

1. Put the test beside the code it covers as `*.test.ts`.
2. Import `test` from `node:test`.
3. Import assertions from `node:assert/strict` only.
4. Use explicit `.ts` extensions for relative imports.
5. Use `import type` for type only imports.
6. Do not skip tests to make a package pass.
7. Make sure the file defines at least one real test.

Example:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { findConnector } from "./index.ts";

test("unknown connector ids return undefined", () => {
  assert.equal(findConnector([], "missing"), undefined);
});
```
