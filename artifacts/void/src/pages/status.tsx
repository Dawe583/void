import { useEffect, useMemo, useState } from "react";
import { PageHero } from "@/components/site/page-hero";
import { Reveal, RevealGroup, RevealItem } from "@/components/site/primitives";
import { fetchStatus, type StatusResponse } from "@/lib/api";
import { statusServices } from "@/lib/site-data";
import { usePageMeta, useVisibleInterval } from "@/lib/use-site";

/** Deterministic 90 day uptime history, so the bars do not jitter on re-render. */
function history(seed: number) {
  return Array.from({ length: 90 }, (_, index) => {
    const value = (Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453) % 1;
    const positive = Math.abs(value);
    if (positive > 0.985) return "bad";
    if (positive > 0.95) return "warn";
    return "ok";
  });
}

export default function StatusPage() {
  usePageMeta(
    "Status, VOID",
    "Region health, uptime history and current latency for the VOID interceptor, policy engine and ledger.",
    "/status",
  );

  const [live, setLive] = useState<StatusResponse | null>(null);
  const [checked, setChecked] = useState<string>("");

  const load = () => {
    fetchStatus()
      .then((data) => {
        setLive(data);
        setChecked(new Date(data.checkedAt).toISOString().slice(11, 19));
      })
      .catch(() => {
        setLive(null);
        setChecked(new Date().toISOString().slice(11, 19));
      });
  };

  useEffect(load, []);
  useVisibleInterval(load, 30_000);

  const services = useMemo(
    () =>
      live?.services?.length
        ? live.services.map((service) => ({
            name: service.name,
            uptime: service.uptime,
            state: service.state,
            latency: `${service.latencyMs}ms`,
          }))
        : statusServices.map((service) => ({ ...service, latency: "" })),
    [live],
  );

  return (
    <>
      <PageHero
        kicker="STATUS / 15"
        title="All systems nominal."
        copy="Live health for the interceptor, policy engine and ledger, refreshed every thirty seconds from the VOID API. Uptime history is illustrative for a product concept."
        meta={[checked ? `checked ${checked} UTC` : "checking", live ? "live from /api/status" : "cached view"]}
      />

      <div style={{ padding: "clamp(30px, 5vw, 56px) var(--gut)" }}>
        <Reveal className="status-banner" data-testid="status-banner">
          <span className="live-dot" aria-hidden="true" />
          <strong>{live?.state ?? "operational"}</strong>
          <span className="mono" style={{ marginLeft: "auto" }}>
            {services.length} services / 90 day window
          </span>
        </Reveal>

        <RevealGroup className="status-list" stagger={0.05}>
          {services.map((service, index) => (
            <RevealItem className="status-item" key={service.name}>
              <div className="status-item-head">
                <strong>{service.name}</strong>
                <span className="row" style={{ gap: 10 }}>
                  {service.latency && <span className="mono">{service.latency}</span>}
                  <span className="mono">{service.uptime}</span>
                  <span className="tag tag-r0">{service.state}</span>
                </span>
              </div>
              <div className="uptime-bars" aria-hidden="true">
                {history(index + 1).map((state, barIndex) => (
                  <i key={barIndex} className={state === "ok" ? "" : state} />
                ))}
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal>
          <p className="mono mt-lg">
            VOID is a product concept. Uptime figures are illustrative. The live check above calls the real
            /api/status endpoint that ships with this site.
          </p>
        </Reveal>
      </div>
    </>
  );
}
