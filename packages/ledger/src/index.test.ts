import test, { describe } from "node:test";
import assert from "node:assert/strict";

import * as ledger from "./index.ts";
import { signingPreimage } from "./index.ts";

const HASH = "a".repeat(64);

describe("@void/ledger", () => {
  test("exports no mutation", () => {
    // Append only in the type system is layer zero of four, and it is the only
    // layer that stops the intent being formed rather than catching it after.
    for (const name of ["update", "delete", "remove", "truncate"]) {
      assert.equal(name in ledger, false, `@void/ledger must not export ${name}`);
    }
  });

  test("the preimage binds the version, the algorithm and the key id", () => {
    const bytes = signingPreimage("ed25519", "ed25519:0123456789abcdef", HASH);
    assert.equal(new TextDecoder().decode(bytes), `void.ledger.v1|ed25519|ed25519:0123456789abcdef|${HASH}`);
  });

  test("the same hash under a different algorithm signs different bytes", () => {
    // Downgrade replay: without the algorithm in the preimage, a signature made
    // under one algorithm is a valid signature of the same entry under another.
    const a = signingPreimage("ed25519", "k1", HASH);
    const b = signingPreimage("ecdsa-p256-sha256", "k1", HASH);
    assert.notDeepEqual(a, b);
  });

  test("refuses a truncated digest", () => {
    // api/_core.ts returns "0x" plus 8 hex characters and api/_store.ts writes
    // that into the hash column, so the persisted chain is linked by 32 bits.
    assert.throws(() => signingPreimage("ed25519", "k1", "0x1a2b3c4d"), TypeError);
    assert.throws(() => signingPreimage("ed25519", "", HASH), TypeError);
  });
});
