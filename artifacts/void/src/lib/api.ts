/**
 * Thin client for the VOID API. The marketing site is served next to the API
 * under the same origin, so a relative base works in development and production.
 */

const BASE = "/api";

export type WaitlistPayload = {
  email: string;
  company: string;
  agents: string;
  frameworks: string[];
  note?: string;
};

export type ContactPayload = {
  email: string;
  name: string;
  topic: string;
  message: string;
};

export type WaitlistReceipt = {
  id: string;
  sequence: number;
  hash: string;
  sealedAt: string;
  stored: boolean;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export function submitWaitlist(payload: WaitlistPayload) {
  return post<WaitlistReceipt>("/waitlist", payload);
}

export function submitContact(payload: ContactPayload) {
  return post<{ id: string; received: string }>("/contact", payload);
}

export type StatusResponse = {
  state: string;
  checkedAt: string;
  services: { name: string; state: string; uptime: string; latencyMs: number }[];
};

export async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch(`${BASE}/status`);
  if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
  return (await response.json()) as StatusResponse;
}
