import { Suspense, lazy } from "react";

import { Hero } from "@/sections/hero";
import { Explore, FieldNotes, Gap, Marquee, Mechanisms } from "@/sections/basics";
import { Install } from "@/sections/install";
import { Replay } from "@/sections/replay";
import { Signal } from "@/sections/signal";
import { Topology } from "@/sections/topology";
import { Classes } from "@/sections/classes";
import { Rollout } from "@/sections/rollout";
import { PricingSection } from "@/sections/pricing";
import { Faq, Record } from "@/sections/record";
import { Access } from "@/sections/access";
import { usePageMeta } from "@/lib/use-site";

// The charts pull in recharts, which is the single heaviest dependency on the
// site. It sits below the fold, so it loads on its own after first paint.
const Telemetry = lazy(() => import("@/sections/telemetry").then((module) => ({ default: module.Telemetry })));

export default function Home() {
  usePageMeta(
    "VOID, reversible autonomy for AI agents",
    "VOID sits between your agents and your tools. It intercepts every write, computes what it would take to undo it, and keeps a signed record you can replay.",
    "/",
  );

  return (
    <>
      <Hero />
      <Marquee />
      <Gap />
      <Mechanisms />
      <Signal />
      <Install />
      <Replay />
      <Topology />
      <Classes />
      <Suspense fallback={<div className="section" style={{ minHeight: 320 }} aria-hidden="true" />}>
        <Telemetry />
      </Suspense>
      <Rollout />
      <PricingSection />
      <FieldNotes />
      <Record />
      <Faq />
      <Access />
      <Explore />
    </>
  );
}
