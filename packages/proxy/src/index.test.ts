import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_POSTURE, isSupportedTransport } from "./index.ts";

describe("@void/proxy", () => {
  test("the default posture is fail closed", () => {
    // Availability is traded for safety here on purpose: a VOID crash becomes
    // an outage of the agent's write path rather than an unrecorded write.
    assert.equal(DEFAULT_POSTURE, "fail-closed");
  });

  test("streamable HTTP is not carried yet, and says so rather than falling back", () => {
    assert.equal(isSupportedTransport("stdio"), true);
    assert.equal(isSupportedTransport("streamable-http"), false);
    assert.equal(isSupportedTransport("sse"), false);
  });
});
