import type { PolicyCall } from "../../policy/src/index.ts";

export type ProbeProviderResult =
  | { readonly radius?: number; readonly facts?: Readonly<Record<string, string>> }
  | { readonly error: string };

export type ProxyProbeCall = PolicyCall & {
  readonly args?: Readonly<Record<string, unknown>>;
};

export type ProbeProvider = (call: ProxyProbeCall) => Promise<ProbeProviderResult>;

export type ConnectorProbeCall = {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
};

export type ConnectorProbe<Executor> = {
  readonly id: string;
  readonly run: (call: ConnectorProbeCall, exec: Executor) => Promise<ProbeProviderResult>;
};

export type ProbePicker<Executor> = (connectorId: string) => readonly ConnectorProbe<Executor>[];

export type ProbeCache<Executor> = {
  readonly run: (probe: ConnectorProbe<Executor>, call: ConnectorProbeCall, exec: Executor) => Promise<ProbeProviderResult>;
};

export function probeDispatcher<Executor>(
  picker: ProbePicker<Executor>,
  cache: ProbeCache<Executor>,
  executor: Executor,
): ProbeProvider {
  return async (call) => {
    let probes: readonly ConnectorProbe<Executor>[];
    try {
      probes = picker(call.connector);
    } catch (error) {
      return { error: errorMessage(error) };
    }

    let radius: number | undefined;
    const facts: Record<string, string> = {};
    const probeCall = { tool: call.tool, args: call.args ?? {} };

    for (const probe of probes) {
      let result: ProbeProviderResult;
      try {
        result = await cache.run(probe, probeCall, executor);
      } catch (error) {
        return { error: errorMessage(error) };
      }
      if ("error" in result) return { error: result.error };
      if (typeof result.radius === "number" && Number.isFinite(result.radius)) {
        radius = radius === undefined ? result.radius : Math.max(radius, result.radius);
      }
      if (result.facts !== undefined) {
        for (const [name, value] of Object.entries(result.facts)) {
          facts[name] ??= value;
        }
      }
    }

    if (radius === undefined && Object.keys(facts).length === 0) return {};
    if (radius === undefined) return { facts };
    if (Object.keys(facts).length === 0) return { radius };
    return { radius, facts };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
