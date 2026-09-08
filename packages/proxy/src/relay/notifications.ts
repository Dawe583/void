type JsonRpcId = string | number;

type JsonObject = { readonly [key: string]: unknown };

// JsonRpcNotification lives in rpc.ts so every module speaks the same shape.
import type { JsonRpcNotification } from "../rpc.ts";
export type { JsonRpcNotification };

export type NotificationRelayResult = {
  readonly forwarded: boolean;
  readonly notification: JsonRpcNotification;
};

export type NotificationRelaySession = {
  readonly agentToUpstream?: ReadonlyMap<JsonRpcId, JsonRpcId>;
  readonly upstreamToAgent?: ReadonlyMap<JsonRpcId, JsonRpcId>;
  readonly progressTokenToAgent?: ReadonlyMap<JsonRpcId, JsonRpcId>;
  readonly cancelledRequestToAgent?: ReadonlyMap<JsonRpcId, JsonRpcId>;
  readonly onUnknownProgressToken?: (token: JsonRpcId) => void;
};

function lookupReverse(map: ReadonlyMap<JsonRpcId, JsonRpcId> | undefined, value: JsonRpcId): JsonRpcId | undefined {
  if (map === undefined) {
    return undefined;
  }

  for (const [candidate, mapped] of map.entries()) {
    if (Object.is(mapped, value)) {
      return candidate;
    }
  }

  return undefined;
}

function translateProgressToken(token: JsonRpcId, session: NotificationRelaySession): JsonRpcId | undefined {
  return session.progressTokenToAgent?.get(token) ?? lookupReverse(session.agentToUpstream, token);
}

function translateCancelledRequest(requestId: JsonRpcId, session: NotificationRelaySession): JsonRpcId | undefined {
  return session.cancelledRequestToAgent?.get(requestId)
    ?? session.upstreamToAgent?.get(requestId)
    ?? lookupReverse(session.agentToUpstream, requestId);
}

function translatedParams(notification: JsonRpcNotification, session: NotificationRelaySession): JsonObject | undefined {
  const params = notification.params;
  if (params === undefined) {
    return undefined;
  }

  let nextParams: JsonObject = { ...params };
  const meta = params._meta;
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    const metaToken = (meta as JsonObject).progressToken;
    if (typeof metaToken === "string" || typeof metaToken === "number") {
      const translated = translateProgressToken(metaToken, session);
      if (translated === undefined) {
        session.onUnknownProgressToken?.(metaToken);
        nextParams = { ...nextParams, _meta: { ...meta } };
      } else {
        nextParams = { ...nextParams, _meta: { ...meta, progressToken: translated } };
      }
    }
  }

  if (notification.method === "notifications/progress") {
    const token = params.progressToken;
    if (typeof token === "string" || typeof token === "number") {
      const translated = translateProgressToken(token, session);
      if (translated === undefined) {
        session.onUnknownProgressToken?.(token);
      } else {
        nextParams = { ...nextParams, progressToken: translated };
      }
    }
  }

  if (notification.method === "notifications/cancelled") {
    const requestId = params.requestId;
    if (typeof requestId === "string" || typeof requestId === "number") {
      nextParams = { ...nextParams, requestId: translateCancelledRequest(requestId, session) ?? requestId };
    }
  }

  return nextParams;
}

export function relayNotification(
  notification: JsonRpcNotification,
  session: NotificationRelaySession,
): NotificationRelayResult {
  const params = translatedParams(notification, session);
  const relayed = params === undefined
    ? { ...notification }
    : { ...notification, params };

  return { forwarded: true, notification: relayed };
}
