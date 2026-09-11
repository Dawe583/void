export type Row = Record<string, any>;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Row> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.message ?? value.error ?? `HTTP ${response.status}`,
    );
  if (value === null || typeof value !== "object")
    throw new Error("Invalid API response");
  return value;
}
export const items = (data?: Row, key = "items"): Row[] =>
  Array.isArray(data?.[key])
    ? data[key]
    : Array.isArray(data?.items)
      ? data.items
      : [];
export function download(name: string, value: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const json = (value: unknown) => JSON.stringify(value, null, 2);
