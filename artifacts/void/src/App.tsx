import { Suspense, lazy, useEffect } from "react";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Shell } from "@/components/site/shell";
import Home from "@/pages/home";

/**
 * Subpages are split out of the homepage bundle. The homepage is what a visitor
 * from an ad or a link lands on, so it pays for nothing it does not render.
 */
const SpecPage = lazy(() => import("@/pages/spec"));
const RegistryPage = lazy(() => import("@/pages/registry"));
const AttestationPage = lazy(() => import("@/pages/attestation"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const SecurityPage = lazy(() => import("@/pages/security"));
const CompliancePage = lazy(() => import("@/pages/compliance"));
const ChangelogPage = lazy(() => import("@/pages/changelog"));
const DocsPage = lazy(() => import("@/pages/docs"));
const StatusPage = lazy(() => import("@/pages/status"));
const ContactPage = lazy(() => import("@/pages/contact"));
const CompanyPage = lazy(() => import("@/pages/company"));
const CzechPage = lazy(() => import("@/pages/cs"));
const NotFound = lazy(() => import("@/pages/not-found"));
const BlogIndex = lazy(() => import("@/pages/blog").then((module) => ({ default: module.BlogIndex })));
const BlogPost = lazy(() => import("@/pages/blog").then((module) => ({ default: module.BlogPost })));

function RouteFallback() {
  return (
    <div style={{ minHeight: "62vh", display: "grid", placeItems: "center", padding: "20vh 24px" }}>
      <span className="kicker">loading</span>
    </div>
  );
}

/** Scrolls to the top on navigation, or to the anchor when the URL carries one. */
function ScrollManager() {
  const [location] = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return null;
}

function Routes() {
  const [location] = useLocation();

  return (
    <ErrorBoundary resetKey={location}>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/spec" component={SpecPage} />
          <Route path="/registry" component={RegistryPage} />
          <Route path="/attestation" component={AttestationPage} />
          <Route path="/pricing" component={PricingPage} />
          <Route path="/security" component={SecurityPage} />
          <Route path="/compliance" component={CompliancePage} />
          <Route path="/changelog" component={ChangelogPage} />
          <Route path="/docs" component={DocsPage} />
          <Route path="/docs/:slug" component={DocsPage} />
          <Route path="/blog" component={BlogIndex} />
          <Route path="/blog/:slug" component={BlogPost} />
          <Route path="/status" component={StatusPage} />
          <Route path="/contact" component={ContactPage} />
          <Route path="/company" component={CompanyPage} />
          <Route path="/cs" component={CzechPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ScrollManager />
      <Shell>
        <Routes />
      </Shell>
    </WouterRouter>
  );
}
