import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import { detectCapabilities } from "./caps.ts";
import { previewHold, previewState } from "./fixtures.ts";
import { renderInlineCall } from "./inline.ts";
import { sanitizeText, stripAnsi, visibleLength } from "./layout.ts";
import { promptForHold, renderHoldPrompt, type RawInput } from "./modal.ts";
import { CLASS_MARKER, VOID_PALETTE } from "./theme.ts";
import type { InterceptedCall, TerminalCapabilities } from "./types.ts";
import {
  renderHelp,
  renderLedgerVerification,
  renderReplayPreview,
} from "./views.ts";
import { renderWatchFrame } from "./watch.ts";

const capabilities = (
  columns: number,
  rows = 40,
  ansi = false,
): TerminalCapabilities => ({
  interactive: ansi,
  ansi,
  colorDepth: ansi ? 24 : 0,
  columns,
  rows,
  reason: ansi ? "interactive" : "not-tty",
});

describe("terminal capabilities", () => {
  test("a pipe disables all ANSI output", () => {
    assert.deepEqual(
      detectCapabilities({}, { isTTY: false, columns: 92, rows: 30 }),
      {
        interactive: false,
        ansi: false,
        colorDepth: 0,
        columns: 92,
        rows: 30,
        reason: "not-tty",
      },
    );
  });

  test("NO_COLOR, TERM dumb and CI degrade independently", () => {
    assert.equal(
      detectCapabilities({ NO_COLOR: "1" }, { isTTY: true }).reason,
      "no-color",
    );
    assert.equal(
      detectCapabilities({ TERM: "dumb" }, { isTTY: true }).reason,
      "dumb",
    );
    assert.equal(detectCapabilities({ CI: "1" }, { isTTY: true }).reason, "ci");
  });
});

describe("VOID visual language", () => {
  test("uses the product palette and a non-colour marker for every class", () => {
    assert.equal(VOID_PALETTE.r3, "#f47a88");
    assert.deepEqual(CLASS_MARKER, {
      r0: "[0]",
      r1: "[1]",
      r2: "[2]",
      r3: "[3]",
    });
  });

  test("inline output truncates the tool from the left and never wraps", () => {
    const call = {
      ...previewState.calls[0]!,
      tool: "vendor.service.resource.action.with.long.name",
    };
    const line = renderInlineCall(call, capabilities(80));
    assert.ok(visibleLength(line) <= 80);
    assert.match(line, /\.action\.with\.long\.name/);
    assert.doesNotMatch(line, /\u001b/);
  });

  test("width counts terminal cells, not code points or code units", () => {
    // A CJK tool id occupies two cells per character. Counting characters
    // instead made a "fitted" 80 character line fill 110 columns of terminal,
    // wrapping in violation of the no wrap contract.
    const call: InterceptedCall = {
      ...previewState.calls[0]!,
      tool: "数据库表格删除操作工具名称很长重复".repeat(2),
    };
    const line = renderInlineCall(call, capabilities(80));
    let cells = 0;
    for (const point of stripAnsi(line)) {
      cells += point.charCodeAt(0) > 0x2e7f ? 2 : 1;
    }
    assert.ok(cells <= 80, `${cells} cells`);
  });
});

describe("external strings cannot inject terminal control", () => {
  // The intercepted call's tool id, agent, workspace, rule and reason all
  // originate outside VOID, and the hold modal is the screen a human reads
  // immediately before approving a write. A CSI clear screen, an OSC title
  // change or a colour code injected there is not cosmetic: it can hide the
  // real class of the call or spoof an allow verdict.
  const hostile: Partial<InterceptedCall> = {
    tool: "postgres.row.update\u001b[2J\u001b]0;pwned",
    agent: "agent\u001b[1;31m[+] allow",
    workspace: "ws\u001b[10;20H",
    policyRule: "rule\u0007",
    reason: "fine\u001b[?1049l",
  };

  test("sanitizeText replaces every control or escape character visibly", () => {
    const cleaned = sanitizeText(
      "a\u001b[2Jb\u001b]0;xc\u0007d\ne\u0000f\u202eg",
    );
    // ESC itself is unprintable and becomes "?", while the remaining "[2J"
    // bytes are ordinary printable text a terminal cannot interpret. What
    // matters is that no ESC, BEL, C0, C1 or bidi override survives.
    assert.doesNotMatch(cleaned, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
    assert.equal(cleaned, "a?[2Jb?]0;xc?d?e?f?g");
  });

  test("the inline renderer emits no escape from a hostile call", () => {
    const line = renderInlineCall(
      { ...previewState.calls[0]!, ...hostile },
      capabilities(80),
    );
    assert.equal(line.split("\n").length, 1);
    assert.doesNotMatch(line, /\u001b|\u0007/);
  });

  test("the hold prompt emits no escape and keeps one line per row", () => {
    const modal = renderHoldPrompt(
      { ...previewHold, call: { ...previewHold.call, ...hostile } },
      capabilities(80),
    );
    assert.doesNotMatch(modal, /\u001b|\u0007/);
    for (const line of modal.split("\n"))
      assert.ok(visibleLength(line) <= 80);
  });

  test("the watch frame sanitizes hostile detail and hold data", () => {
    const frame = renderWatchFrame(
      {
        ...previewState,
        calls: [{ ...previewState.calls[0]!, ...hostile }],
        holds: [{ ...previewHold, call: { ...previewHold.call, ...hostile } }],
      },
      capabilities(120, 48),
      0,
    );
    // paint() legitimately emits SGR, but nothing from the hostile payload:
    // the only ESC bytes in the frame come from paint itself, and the injected
    // clear screen, cursor move and BEL are absent.
    assert.doesNotMatch(frame, /\u001b\[2J|\u001b\]0;|\u001b\[10;20H|\u0007/);
    assert.doesNotMatch(frame, /EVIL/);
  });

  test("a hostile session agent cannot blank the header", () => {
    // The header is on the line every frame starts from, and a persistent
    // escape there survives every diff repaint, so the agent identity is
    // sanitized like the call fields even though it arrives once per session.
    const frame = renderWatchFrame(
      {
        ...previewState,
        session: {
          ...previewState.session,
          agent: "claude\u001b[2J\u001b]0;pwned",
        },
      },
      capabilities(120, 48, true),
      0,
    );
    assert.doesNotMatch(frame, /\u001b\[2J|\u001b\]0;/);
  });

  test("emoji tool ids do not wrap at narrow widths", () => {
    // U+1F680 ROCKET and U+2705 are two cell characters in real terminals
    // although the East Asian Width property alone does not force it; the
    // model agreed with itself while the terminal wrapped.
    const call: InterceptedCall = {
      ...previewState.calls[0]!,
      tool: "\u{1F680}".repeat(30),
    };
    const line = renderInlineCall(call, capabilities(80));
    let cells = 0;
    for (const point of stripAnsi(line)) {
      const code = point.codePointAt(0) ?? 0;
      if (
        (code >= 0x2600 && code <= 0x27bf) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0x20000 && code <= 0x3fffd)
      )
        cells += 2;
      else cells += 1;
    }
    assert.ok(cells <= 80, `${cells} cells`);
  });
});

describe("the hold modal under constraints", () => {
  test("the action row survives a 12 row terminal", () => {
    // Twelve rows is the floor caps.ts clamps to, and a modal whose approve
    // and cancel keys are cropped away still accepts those keys invisibly,
    // which is the worst shape a decision screen can fail in.
    const modal = renderHoldPrompt(previewHold, capabilities(76, 12));
    assert.match(modal, /\[a\] approve once/);
    assert.match(modal, /\[c\] cancel/);
    assert.match(modal, /HOLDING/);
    const lines = modal.split("\n");
    assert.ok(lines.length <= 12);
    for (const line of lines) assert.ok(visibleLength(line) <= 76);
  });

  test("an expired hold cannot be approved by a late keypress", async () => {
    // The keypress path checks expiry itself, not only the redraw tick, so
    // an a arriving between ticks after expiry resolves expired.
    class FakeInput extends EventEmitter {
      readonly modes: boolean[] = [];
      setRawMode(mode: boolean): void {
        this.modes.push(mode);
      }
      resume(): void {}
      pause(): void {}
    }
    const input = new FakeInput();
    const expired = {
      ...previewHold,
      openedAt: 0,
      expiresAt: 1_000,
    };
    const resolution = promptForHold(
      expired,
      capabilities(80, 30, true),
      input as RawInput,
      { write: () => true },
      () => 2_000,
    );
    input.emit("data", Buffer.from("a"));
    assert.equal(await resolution, "expired");
  });
});

describe("watch dashboard", () => {
  for (const width of [80, 120, 200]) {
    test(`fits every line at ${width} columns`, () => {
      const frame = renderWatchFrame(previewState, capabilities(width, 48));
      for (const line of frame.split("\n"))
        assert.ok(
          visibleLength(line) <= width,
          `${visibleLength(line)} > ${width}: ${stripAnsi(line)}`,
        );
      assert.match(frame, /WRITE PATH/);
      assert.match(frame, /postgres\.table\.drop/);
      assert.match(frame, /q quit/);
    });
  }

  test("hold prompt includes risk, measured radius and explicit actions without colour", () => {
    const modal = renderHoldPrompt(previewHold, capabilities(80));
    assert.match(modal, /\[2\] R2/);
    assert.match(modal, /1 target, measured/);
    assert.match(modal, /\[a\] approve once/);
    assert.match(modal, /\[c\] cancel/);
    assert.doesNotMatch(modal, /\u001b/);
  });

  test("ANSI styling remains width safe", () => {
    const frame = renderWatchFrame(previewState, capabilities(120, 40, true));
    for (const line of frame.split("\n")) assert.ok(visibleLength(line) <= 120);
    assert.match(frame, /\u001b\[/);
  });

  test("ANSI boxes and inline calls preserve their exact structural width", () => {
    const terminal = capabilities(80, 40, true);
    const modal = renderHoldPrompt(previewHold, terminal);
    assert.equal(visibleLength(modal.split("\n")[0]!), 76);
    assert.equal(
      visibleLength(renderInlineCall(previewState.calls[0]!, terminal)),
      80,
    );
  });
});

describe("decision views", () => {
  test("replay is always presented as a preview before confirmation", () => {
    const view = renderReplayPreview(
      {
        workspace: "payments-dev",
        to: "2026-09-06T12:00:00Z",
        steps: [
          {
            order: 1,
            callId: "call_7fs1",
            tool: "postgres.row.update",
            target: "orders/42",
            class: "r0",
            action: "restore before image",
            precondition: "row version unchanged",
          },
        ],
        blocked: [],
        snapshotBytes: 248,
      },
      capabilities(96),
    );
    assert.match(view, /NO CHANGES MADE/);
    assert.match(view, /explicit confirmation/);
  });

  test("a development signing key never renders as plain valid", () => {
    const view = renderLedgerVerification(
      {
        valid: true,
        developmentKey: true,
        entries: 12,
        verifiedThrough: 12,
        head: "sha256:abc",
        keyId: "dev-ed25519:test",
        bodyFailures: [],
        linkFailures: [],
        signatureFailures: [],
      },
      capabilities(82),
    );
    assert.match(view, /valid, development key/);
    assert.doesNotMatch(view, /^\|\[\+\] valid\s+\|$/m);
  });

  test("help explains that display pause and quit never stop the proxy", () => {
    const help = renderHelp(capabilities(80));
    assert.match(help, /pause display updates, never the proxy/);
    assert.match(help, /leave watch mode, never stop the proxy/);
  });
});

describe("terminal lifecycle", () => {
  test("a hold restores raw mode after one keypress", async () => {
    class FakeInput extends EventEmitter {
      readonly modes: boolean[] = [];
      setRawMode(mode: boolean): void {
        this.modes.push(mode);
      }
      resume(): void {}
      pause(): void {}
    }
    const input = new FakeInput();
    let output = "";
    const resolution = promptForHold(
      previewHold,
      capabilities(80, 30, true),
      input as RawInput,
      {
        write: (chunk: string | Uint8Array) => {
          output += String(chunk);
          return true;
        },
      },
    );
    input.emit("data", Buffer.from("a"));
    assert.equal(await resolution, "approve");
    assert.deepEqual(input.modes, [true, false]);
    assert.match(output, /\u001b\[\?25h/);
    assert.match(output, /\u001b\[\?1049h/);
    assert.match(output, /\u001b\[\?1049l/);
  });
});

describe("TUIStudio sources", () => {
  for (const name of ["void-operations.tui", "void-hold.tui"]) {
    test(`${name} is a loadable version 1 project`, async () => {
      const source = await readFile(
        new URL(`../../design/${name}`, import.meta.url),
        "utf8",
      );
      const project = JSON.parse(source) as {
        version?: string;
        tree?: { type?: string };
      };
      assert.equal(project.version, "1");
      assert.equal(project.tree?.type, "Screen");
    });
  }
});
