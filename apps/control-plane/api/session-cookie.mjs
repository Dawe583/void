// Renew on authenticated use, within the browser's 400-day cookie limit.
export const workspaceSessionCookie = (token = "") =>
  `__Host-void-session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${token ? 34560000 : 0}`;
