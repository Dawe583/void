import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="not-found">
      <div>
        <div className="not-found-art" aria-hidden="true">{`V O I D
· . : + * = < > / \\
  .  .  .  .  .
    #  #  #  #
       4 0 4`}</div>
        <div className="kicker" style={{ marginTop: 35 }}>[ 404 ] NULL ROUTE</div>
        <h1 className="section-title">This path has no inverse.</h1>
        <p className="section-copy" style={{ margin: "0 auto 28px" }}>The requested page is not in the ledger. Return to the write path or read the specification.</p>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link data-testid="link-404-home" className="btn btn-primary" href="/">return home ↗</Link>
          <Link data-testid="link-404-spec" className="btn btn-ghost" href="/spec">read the spec</Link>
        </div>
      </div>
    </div>
  );
}