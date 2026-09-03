import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PageHero } from "@/components/site/page-hero";
import { Counter, Icon, Reveal, RevealGroup, RevealItem } from "@/components/site/primitives";
import { usePageMeta } from "@/lib/use-site";
import { EASE } from "@/lib/motion";
import {
  REGISTRY_DISCLAIMER,
  REGISTRY_VERSION,
  TONE_LABEL,
  bestCase,
  isConditional,
  registry,
  registryStats,
  registryVendors,
  searchRegistry,
  worstCase,
  type RegistryEntry,
  type RegistryTone,
} from "@shared/_registry";

const TONES: RegistryTone[] = ["r0", "r1", "r2", "r3"];
const TONE_RANK: Record<RegistryTone, number> = { r0: 0, r1: 1, r2: 2, r3: 3 };

/**
 * A four cell strip spanning best case to worst case. The whole argument of the
 * registry is in this widget: one call, two classes, and the configuration of
 * the target decides which one you are in.
 */
function Spread({ entry }: { entry: RegistryEntry }) {
  const best = TONE_RANK[bestCase(entry)];
  const worst = TONE_RANK[worstCase(entry)];

  return (
    <span className="reg-spread" aria-hidden="true">
      {TONES.map((tone, index) => (
        <span
          key={tone}
          className={`reg-spread-cell ${index >= best && index <= worst ? "is-on" : ""}`}
          data-tone={tone}
        />
      ))}
    </span>
  );
}

function CaseTable({ entry }: { entry: RegistryEntry }) {
  return (
    <div className="reg-cases">
      {entry.cases.map((item, index) => (
        <div className="reg-case" key={`${entry.id}-${index}`} data-tone={item.tone}>
          <div className="reg-case-when">
            <span className="reg-case-index">{index + 1}</span>
            <code>{item.when === "always" ? "otherwise" : item.when}</code>
          </div>
          <div className="reg-case-class">
            <span className={`tag tag-${item.tone}`}>
              {item.tone.toUpperCase()} {TONE_LABEL[item.tone]}
            </span>
          </div>
          <div className="reg-case-inverse">
            <h6>Inverse</h6>
            {item.inverse ? <code>{item.inverse}</code> : <span className="reg-none">none exists</span>}
            <h6>Window</h6>
            <span>{item.window}</span>
          </div>
          <p className="reg-case-note">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

export default function RegistryPage() {
  usePageMeta(
    "Reversibility Registry, VOID",
    "An open registry of what undoes what. Every tool call classified against the state of its target, with the compensating call and the window it stays valid.",
    "/registry",
  );

  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const [tone, setTone] = useState<RegistryTone | null>(null);
  const [conditionalOnly, setConditionalOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const stats = useMemo(() => registryStats(), []);
  const vendors = useMemo(() => registryVendors(), []);

  const results = useMemo(
    () =>
      searchRegistry({
        q: query,
        vendor: vendor ?? undefined,
        tone: tone ?? undefined,
        conditionalOnly,
      }),
    [query, vendor, tone, conditionalOnly],
  );

  const filtered = query !== "" || vendor !== null || tone !== null || conditionalOnly;

  return (
    <>
      <PageHero
        kicker={`REGISTRY / ${REGISTRY_VERSION}`}
        title="A class is not a property of a call."
        copy="Deleting an S3 object is fully reversible with bucket versioning on and irreversible with it off. Same call, same arguments, two different classes. So this registry does not store a class per call. It stores an ordered list of cases, each guarded by a precondition, and the first one that holds decides."
        meta={[`${stats.entries} entries`, `${stats.vendors} vendors`, `${stats.cases} cases`, "open format", "MIT licensed"]}
      />

      <section className="section" aria-labelledby="registry-stats-label">
        <Reveal className="section-head">
          <span className="kicker" id="registry-stats-label">
            [ 01 ] COVERAGE
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <RevealGroup className="reg-stats">
          <RevealItem className="reg-stat">
            <strong>
              <Counter to={stats.entries} />
            </strong>
            <span>calls classified</span>
          </RevealItem>
          <RevealItem className="reg-stat">
            <strong>
              <Counter to={stats.cases} />
            </strong>
            <span>preconditioned cases</span>
          </RevealItem>
          <RevealItem className="reg-stat is-lead">
            <strong>
              <Counter to={stats.conditional} />
            </strong>
            <span>change class with configuration</span>
          </RevealItem>
          <RevealItem className="reg-stat">
            <strong>
              <Counter to={stats.wideSpread} />
            </strong>
            <span>move by two classes or more</span>
          </RevealItem>
        </RevealGroup>

        <Reveal className="reg-thesis">
          <p>
            <b>
              {stats.conditional} of {stats.entries} entries are not a fixed class.
            </b>{" "}
            That is the finding worth acting on. A policy engine that classifies by call name is wrong most of the
            time, in whichever direction happens to be convenient. VOID reads the precondition at intercept time,
            which is why the same call can be waved through on one bucket and held on another.
          </p>
        </Reveal>
      </section>

      <section className="section" aria-labelledby="registry-browse-label">
        <Reveal className="section-head">
          <span className="kicker" id="registry-browse-label">
            [ 02 ] BROWSE
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <div className="reg-controls">
          <label className="reg-search">
            <Icon name="radar" size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search calls, vendors, preconditions"
              aria-label="Search the registry"
              data-testid="input-registry-search"
            />
          </label>

          <div className="reg-tones" role="group" aria-label="Filter by worst case class">
            {TONES.map((item) => (
              <button
                key={item}
                type="button"
                className={`reg-tone ${tone === item ? "is-on" : ""}`}
                data-tone={item}
                aria-pressed={tone === item}
                onClick={() => setTone(tone === item ? null : item)}
                data-testid={`button-registry-tone-${item}`}
              >
                {item.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={`reg-tone is-wide ${conditionalOnly ? "is-on" : ""}`}
              aria-pressed={conditionalOnly}
              onClick={() => setConditionalOnly(!conditionalOnly)}
              data-testid="button-registry-conditional"
            >
              conditional only
            </button>
          </div>
        </div>

        <div className="reg-vendors" role="group" aria-label="Filter by vendor">
          <button
            type="button"
            className={`reg-vendor ${vendor === null ? "is-on" : ""}`}
            onClick={() => setVendor(null)}
            aria-pressed={vendor === null}
          >
            all <i>{registry.length}</i>
          </button>
          {vendors.map((item) => (
            <button
              key={item.vendor}
              type="button"
              className={`reg-vendor ${vendor === item.vendor ? "is-on" : ""}`}
              onClick={() => setVendor(vendor === item.vendor ? null : item.vendor)}
              aria-pressed={vendor === item.vendor}
              data-testid={`button-registry-vendor-${item.vendor}`}
            >
              {item.vendor} <i>{item.count}</i>
            </button>
          ))}
        </div>

        <div className="reg-count" aria-live="polite">
          <span>
            {results.length} {results.length === 1 ? "entry" : "entries"}
            {filtered ? ` of ${registry.length}` : ""}
          </span>
          {filtered && (
            <button
              type="button"
              className="reg-clear"
              onClick={() => {
                setQuery("");
                setVendor(null);
                setTone(null);
                setConditionalOnly(false);
              }}
            >
              clear filters
            </button>
          )}
        </div>

        <div className="reg-list">
          {results.map((entry) => {
            const isOpen = open === entry.id;
            const worst = worstCase(entry);
            const conditional = isConditional(entry);

            return (
              <div className="reg-row" key={entry.id} data-tone={worst}>
                <button
                  type="button"
                  className="reg-trigger"
                  aria-expanded={isOpen}
                  aria-controls={`reg-panel-${entry.id}`}
                  onClick={() => setOpen(isOpen ? null : entry.id)}
                  data-testid={`button-registry-entry-${entry.id}`}
                >
                  <Spread entry={entry} />
                  <span className="reg-id">
                    <code>{entry.id}</code>
                    <em>{entry.surface}</em>
                  </span>
                  <span className="reg-summary">{entry.summary}</span>
                  <span className="reg-flags">
                    {conditional && <span className="reg-flag">conditional</span>}
                    <span className={`tag tag-${worst}`}>{worst.toUpperCase()}</span>
                  </span>
                  <span className="reg-plus" aria-hidden="true">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`reg-panel-${entry.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <CaseTable entry={entry} />
                      <div className="reg-tags">
                        {entry.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                        <a className="reg-api-link" href={`/api/registry?id=${entry.id}`} target="_blank" rel="noreferrer">
                          view as JSON <Icon name="arrowUpRight" size={13} />
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {results.length === 0 && (
            <p className="reg-empty">
              Nothing matches that filter. The registry is a draft at {stats.entries} calls, so a gap is likely to
              be a gap, not a judgement.
            </p>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="registry-api-label">
        <Reveal className="section-head">
          <span className="kicker" id="registry-api-label">
            [ 03 ] API AND FORMAT
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <Reveal>
          <h2 className="h2">Queryable, and the same data VOID enforces on.</h2>
          <p className="lede mt-sm">
            The interceptor does not carry its own copy. This registry, this endpoint and the classification that
            runs at intercept time are one module, which is the only way they stay in agreement.
          </p>
        </Reveal>

        <div className="reg-api">
          <Reveal className="codebox">
            <pre>{`# every entry
curl https://void.systems/api/registry

# one call
curl https://void.systems/api/registry?id=aws.s3.object.delete

# only the ones whose class moves with configuration
curl "https://void.systems/api/registry?conditional=1&vendor=aws"

# facets and coverage
curl https://void.systems/api/registry?view=stats`}</pre>
          </Reveal>

          <Reveal className="codebox">
            <pre>{`{
  "id": "aws.s3.object.delete",
  "vendor": "aws",
  "surface": "S3",
  "summary": "Delete an object by key.",
  "cases": [
    {
      "when": "bucket versioning is Enabled and MFA delete is off",
      "tone": "r0",
      "inverse": "s3:DeleteObject on the delete marker",
      "window": "until a lifecycle rule expires noncurrent versions",
      "note": "the delete only writes a marker"
    },
    { "when": "always", "tone": "r3", "inverse": null }
  ]
}`}</pre>
          </Reveal>
        </div>

        <Reveal className="reg-disclaimer">
          <Icon name="alert" size={16} />
          <p>
            <b>Registry {REGISTRY_VERSION}.</b> {REGISTRY_DISCLAIMER} Preconditions are the part that goes stale
            first, which is why entries are dated by registry version rather than presented as timeless facts.
          </p>
        </Reveal>
      </section>
    </>
  );
}
