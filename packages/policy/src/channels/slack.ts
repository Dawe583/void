/**
 * Slack approval channel, WP-05. Webhook delivery is an announcement only.
 *
 * The approval URL belongs to the operator, not this package, so a Slack
 * outage or a missing webhook can only report delivery failure. It must not
 * decide the held call or break the CLI approval path.
 */

import type { HeldCall } from "../hold.ts";

export type SlackPostResult =
  | { readonly kind: "posted"; readonly status: number }
  | { readonly kind: "disabled" }
  | { readonly kind: "failed"; readonly reason: string };

export type SlackChannelOptions = {
  readonly enabled: boolean;
  readonly webhookUrl?: string;
};

type Fetcher = (input: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

type SlackTextObject = {
  readonly type: "plain_text" | "mrkdwn";
  readonly text: string;
};

type SlackButton = {
  readonly type: "button";
  readonly text: SlackTextObject;
  readonly style?: "primary" | "danger";
  readonly url: string;
};

type SlackBlock =
  | { readonly type: "section"; readonly text: SlackTextObject }
  | { readonly type: "actions"; readonly elements: readonly SlackButton[] };

export type SlackPayload = {
  readonly text: string;
  readonly blocks: readonly SlackBlock[];
};

function touched(call: HeldCall): string {
  return call.blastRadius === undefined ? "unknown" : `${call.blastRadius}`;
}

export function slackPayload(call: HeldCall, resolveUrl: (id: string) => string): SlackPayload {
  const title = `held: ${call.tool} (${call.klass}, ${touched(call)} touched)`;
  const rationale = call.rationale ?? "No rationale provided.";
  const base = resolveUrl(call.id);
  const separator = base.includes("?") ? "&" : "?";
  return {
    text: `${title}
${rationale}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${title}*
${rationale}` } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            url: `${base}${separator}decision=approve`,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny" },
            style: "danger",
            url: `${base}${separator}decision=deny`,
          },
        ],
      },
    ],
  };
}

export async function postHoldToSlack(
  webhookUrl: string,
  call: HeldCall,
  resolveUrl: (id: string) => string,
  fetcher: Fetcher = globalThis.fetch,
): Promise<SlackPostResult> {
  try {
    const response = await fetcher(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackPayload(call, resolveUrl)),
    });
    if (!response.ok) {
      const body = await response.text();
      return { kind: "failed", reason: `slack webhook returned ${response.status}${body === "" ? "" : `: ${body}`}` };
    }
    return { kind: "posted", status: response.status };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export class SlackChannel {
  private readonly enabled: boolean;
  private readonly webhookUrl: string | undefined;
  private readonly fetcher: Fetcher;

  constructor(options: SlackChannelOptions, fetcher: Fetcher = globalThis.fetch) {
    this.enabled = options.enabled;
    this.webhookUrl = options.webhookUrl;
    this.fetcher = fetcher;
  }

  async postHold(call: HeldCall, resolveUrl: (id: string) => string): Promise<SlackPostResult> {
    if (!this.enabled) return { kind: "disabled" };
    if (this.webhookUrl === undefined || this.webhookUrl === "")
      return { kind: "failed", reason: "slack webhook url is required when enabled" };
    return postHoldToSlack(this.webhookUrl, call, resolveUrl, this.fetcher);
  }
}
