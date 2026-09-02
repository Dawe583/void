import { PageHero } from "@/components/site/page-hero";
import { Reveal, RevealGroup, RevealItem } from "@/components/site/primitives";
import { changelog } from "@/lib/site-data";
import { usePageMeta } from "@/lib/use-site";

export default function ChangelogPage() {
  usePageMeta(
    "Changelog, VOID",
    "Reverse chronological notes from the VOID private beta. Every entry is a change to the write path.",
    "/changelog",
  );

  return (
    <>
      <PageHero
        kicker="CHANGELOG / 13"
        title="The undo stack keeps changing."
        copy="Reverse chronological notes from a private beta. Each entry is a small change to the write path, written for the engineer who has to upgrade."
        meta={[`${changelog.length} releases`, `latest ${changelog[0].version}`, "private beta"]}
      />

      <div style={{ padding: "clamp(30px, 5vw, 56px) var(--gut)" }}>
        <RevealGroup stagger={0.06}>
          {changelog.map((entry) => (
            <RevealItem key={entry.version}>
              <article className="changelog-entry" data-testid={`entry-changelog-${entry.version}`}>
                <div className="changelog-head">
                  <span className="tag tag-accent">v{entry.version}</span>
                  <span className="mono">{entry.date}</span>
                  <span className="tag">{entry.tag}</span>
                </div>
                <h3 className="h3">{entry.title}</h3>
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal>
          <p className="mono mt-lg">
            VOID is a product concept. Releases listed here are illustrative.
          </p>
        </Reveal>
      </div>
    </>
  );
}
