import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "wouter";
import {
  Counter,
  Icon,
  Magnetic,
  Reveal,
  RevealGroup,
  RevealItem,
  Section,
  SplitHeading,
  Spotlight,
} from "@/components/site/primitives";
import { CodeBlock } from "@/sections/install";
import { codeSamples, mechanisms, toneVar } from "@/lib/site-data";
import { EASE, staggerParent } from "@/lib/motion";
import { usePageMeta } from "@/lib/use-site";

const csMechanisms: Record<string, { name: string; body: string; meta: string }> = {
  interceptor: {
    name: "Interceptor",
    body: "Postavte VOID před libovolný nástroj: MCP servery, HTTP nástroje, function calling nebo vlastní SDK. Jeden řádek konfigurace, smyčka agenta se nemění.",
    meta: "MCP / SDK / HTTP / CLI",
  },
  preflight: {
    name: "Preflight",
    body: "Než se volání potvrdí, VOID spočítá jeho dopad: které systémy se změní, kolik záznamů, která pole a jakou má akce třídu vratnosti. Politika povolí, pozdrží nebo zamítne.",
    meta: "8 až 40 ms navíc",
  },
  compensation: {
    name: "Kompilátor kompenzací",
    body: "Ke každému zachycenému volání VOID sestaví opačnou akci a uloží snímek stavu před zápisem. Z vytvoření se stane smazání, z úpravy obnovení, z commitu revert.",
    meta: "inverze a snímek ke každému volání",
  },
  ledger: {
    name: "Saga ledger",
    body: "Připojovací, hashově řetězený a podepsaný záznam záměru, payloadu, výsledku, snímku a plánu kompenzace. Undo zásobník a auditní záznam jsou jeden objekt.",
    meta: "podepsáno ed25519",
  },
  scrubber: {
    name: "Časový posuvník",
    body: "Vyberte okamžik. VOID přehraje kompenzace v pořadí LIFO napříč všemi připojenými systémy a živě ukáže, co se vrátilo a co ne.",
    meta: "přehrání napříč systémy",
  },
  budget: {
    name: "Rozpočet nevratnosti",
    body: "Každý agent má denní příděl nevratných akcí. Jakmile ho vyčerpá, přepne se do režimu pouze pro čtení, dokud ho člověk nedoplní. Z autonomie se stane měřená veličina.",
    meta: "na agenta, na den",
  },
};

const csFaq: [string, string][] = [
  [
    "Co se stane, když akci opravdu nelze vrátit?",
    "Je označena třídou R3 ještě před voláním, ne až po něm. VOID vyžaduje, aby ji politika povolila, odečte ji z denního rozpočtu nevratnosti, uloží důkazní balíček včetně identity schvalovatele a zapíše záznam jako konečný. Při přehrání takové řádky vypíší, že je nešlo vrátit, i s důvodem.",
  ],
  [
    "Zpomalí VOID moje agenty?",
    "Preflight přidá 8 až 40 ms podle toho, kolika systémů se volání týká. Commity se neblokují, pokud to politika výslovně neurčí. Čtecí volání celou pipeline přeskočí.",
  ],
  [
    "Vidíte moje data?",
    "V self hosted režimu nic neopustí vaši infrastrukturu. Interceptor, politika i ledger běží u vás. V řízeném režimu nastavíte redakci na úrovni polí a podpisové klíče zůstávají ve vašem KMS.",
  ],
  [
    "Které frameworky podporujete?",
    "Cokoli, co volá nástroje. Máme adaptéry pro LangGraph, CrewAI, OpenAI Agents SDK, Claude Agent SDK a běžné function calling smyčky. MCP proxy funguje i bez podpory frameworku, protože sedí na úrovni transportu.",
  ],
  [
    "Můžu to nejdřív zkusit v tichém režimu?",
    "To je doporučený první týden. Shadow mode zaznamenává záměr, počítá třídy a staví plány kompenzací, aniž by cokoli držel. Na konci týdne máte reálné číslo, kolik nevratných akcí vaši agenti dělají.",
  ],
];

const csClasses = [
  { id: "r0" as const, title: "R0", subtitle: "plně vratné", body: "Předchozí stav se vrátí přesně. VOID uloží snímek před zápisem a obnoví ho, aniž by si toho kdokoli mimo systém všiml." },
  { id: "r1" as const, title: "R1", subtitle: "vratné se stopou", body: "Stav se vrátí, ale změna byla po dobu své existence viditelná. Vytvořený tiket lze smazat, někdo ho ale už mohl vidět ve frontě." },
  { id: "r2" as const, title: "R2", subtitle: "pouze zmírnitelné", body: "Skutečná inverze neexistuje. Nejlepší dostupná akce sníží škodu a informuje dotčenou stranu. VOID zapíše, že šlo o zmírnění, ne o vrácení." },
  { id: "r3" as const, title: "R3", subtitle: "nevratné", body: "Peníze odešly, data byla zničena nebo externí systém potvrdil něco, co neovládáte. VOID to nevrátí, takže to stojí rozpočet, vyžaduje schválení a založí důkazní balíček." },
];

export default function CzechPage() {
  usePageMeta(
    "VOID, vratná autonomie pro AI agenty",
    "VOID sedí mezi vašimi agenty a nástroji. Zachytí každý zápis, spočítá, co by stálo ho vrátit, a vede podepsaný záznam, který můžete přehrát.",
    "/cs",
  );

  const [tab, setTab] = useState("TypeScript");
  const item = {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
  };

  return (
    <>
      <section className="hero" aria-label="VOID, vratná autonomie pro AI agenty">
        <div className="hero-grid">
          <motion.div initial="hidden" animate="show" variants={staggerParent(0.09)}>
            <motion.div variants={item}>
              <span className="hero-eyebrow">
                <b>PRIVÁTNÍ BETA</b>
                <span>vrstva vratné autonomie</span>
              </span>
            </motion.div>

            <motion.h1 className="h1" variants={item}>
              Každá akce vašich agentů, <span className="gradient-text">vratná</span>.
            </motion.h1>

            <motion.p className="hero-sub" variants={item}>
              VOID sedí mezi vašimi agenty a nástroji. Zachytí každý zápis, spočítá, co by stálo ho vrátit, a
              vede podepsaný záznam, který můžete přehrát. Ctrl+Z pro autonomní systémy.
            </motion.p>

            <motion.div className="hero-actions" variants={item}>
              <Magnetic>
                <Link href="/#access" className="btn btn-primary btn-lg" data-testid="link-cs-access">
                  Požádat o přístup
                  <Icon name="arrow" size={16} />
                </Link>
              </Magnetic>
              <Magnetic strength={0.14}>
                <Link href="/spec" className="btn btn-ghost btn-lg" data-testid="link-cs-spec">
                  Přečíst specifikaci
                </Link>
              </Magnetic>
            </motion.div>

            <motion.p className="hero-note" variants={item}>
              Privátní beta / self hosted nebo řízené / SDK, MCP proxy nebo CLI
            </motion.p>

            <motion.div className="hero-stats" variants={item}>
              <div>
                <strong>
                  <Counter to={73.4} decimals={1} suffix="%" />
                </strong>
                <span>zápisů s inverzí</span>
              </div>
              <div>
                <strong>
                  <Counter to={40} />
                  ms
                </strong>
                <span>nejhorší preflight</span>
              </div>
              <div>
                <strong>
                  <Counter to={14} />
                </strong>
                <span>systémů, jedna cesta</span>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.3 }}
          >
            <div className="terminal">
              <div className="terminal-bar">
                <span className="terminal-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="terminal-title">obr. 01, relace</span>
              </div>
              <div className="terminal-body">
                <div className="t-cmd">$ void rewind --to 09:12:00</div>
                <div className="t-ok">{"  <- obnovuji 412 polí ve 3 systémech ....... hotovo"}</div>
                <div className="t-ok">{"  <- ruším 3 rezervace v kalendáři .......... hotovo"}</div>
                <div className="t-warn">{"  <- stahuji 1 e-mail ....................... zmírněno (R2)"}</div>
                <div className="t-bad">{"  1 akci nešlo vrátit (R3), je zapsána výše."}</div>
                <div className="t-dim">{" "}</div>
                <div className="t-cmd">$ void report --since 7d</div>
                <div className="t-dim">{"  zachyceno         18 422 volání"}</div>
                <div className="t-ok">{"  vratné (R0/R1)    13 517  73,4 %"}</div>
                <div className="t-warn">{"  zmírnitelné (R2)   3 908  21,2 %"}</div>
                <div className="t-bad">{"  nevratné (R3)        997   5,4 %"}</div>
                <span className="caret" />
              </div>
              <div className="caption">
                <span>obr. 01, zachycená relace</span>
                <span>ilustrativní výstup</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <Section id="cs-gap" index="01" label="MEZERA">
        <SplitHeading text="Váš stack umí sledovat, filtrovat a ptát se. Neumí vrátit změnu." className="h2" />
        <p className="lede mt-sm">
          Agenti už nejen odpovídají. Zapisují do CRM, vracejí platby, posílají e-maily, mažou soubory a mění
          infrastrukturu. Bezpečnostní vrstva, kterou dnes provozujete, nemá krok, který by cokoli vrátil zpět.
        </p>

        <RevealGroup className="gap-grid mt-lg">
          {[
            ["01 / OBSERVABILITA", "Vidí to až potom", "Tracing vám řekne, co agent udělal, když už je následek ve světě. Skvělé na ladění chování, nepoužitelné na obnovu."],
            ["02 / GUARDRAILS", "Blokují prompt, ne zápis", "Filtry chytají slova a vstupy dřív, než model promluví. Změněný záznam ale neobnoví a platbu nestáhnou."],
            ["03 / SCHVALOVÁNÍ", "Člověk klikne na ano", "Schválení posune okamžik odpovědnosti o krok dřív. Nepořádek pak stejně řeší ten člověk."],
          ].map(([kicker, title, body]) => (
            <RevealItem key={kicker}>
              <Spotlight className="gap-cell">
                <span className="kicker">{kicker}</span>
                <span className="cross" aria-hidden="true">
                  &times;
                </span>
                <h3 className="h3">{title}</h3>
                <p>{body}</p>
              </Spotlight>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="gap-answer" delay={0.1}>
          <strong>VOID vrací zápis zpět.</strong>
          <span>preflight &rarr; kompenzace &rarr; přehrání</span>
        </Reveal>
      </Section>

      <Section id="cs-mechanisms" index="02" label="MECHANISMY">
        <SplitHeading text="Šest pohyblivých částí, jedna jistota." className="h2" />
        <RevealGroup className="mech-grid mt-lg" stagger={0.06}>
          {mechanisms.map((mechanism, index) => {
            const cs = csMechanisms[mechanism.id];
            return (
              <RevealItem className="mech" key={mechanism.id}>
                <span className="mech-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <pre className="mech-art" aria-hidden="true">{mechanism.art}</pre>
                <h3 className="h3">{cs.name}</h3>
                <p>{cs.body}</p>
                <span className="mech-meta">{cs.meta}</span>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Section>

      <Section id="cs-install" index="03" label="NASAZENÍ">
        <SplitHeading text="Tři řádky, před cokoli." className="h2" />
        <p className="lede mt-sm">
          SDK obalí existující nástroje, aniž by měnilo smyčku agenta. MCP proxy se nasadí na úrovni transportu.
          CLI dá platformnímu týmu přehled ještě před zásahem do kódu.
        </p>
        <div className="install-grid mt-lg">
          <Reveal>
            <div className="tabs" role="tablist" aria-label="Způsob nasazení">
              {Object.keys(codeSamples).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`tab ${tab === key ? "is-on" : ""}`}
                  onClick={() => setTab(key)}
                  data-testid={`tab-cs-${key.toLowerCase()}`}
                >
                  {tab === key && <motion.span layoutId="cs-tab-pill" className="tab-pill" />}
                  <span style={{ position: "relative" }}>{key}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
              >
                <CodeBlock code={codeSamples[tab]} label={tab.toLowerCase()} />
              </motion.div>
            </AnimatePresence>
          </Reveal>

          <Reveal className="side-note" delay={0.08}>
            <span className="kicker">Malý slib</span>
            <h3 className="h3">Jakýkoli agent. Jakýkoli nástroj. Jedna vrstva v cestě zápisu.</h3>
            <ul>
              <li>Žádná změna smyčky agenta, promptů ani volby modelu.</li>
              <li>Nástroje se klasifikují při připojení, takže třídy existují před prvním voláním.</li>
              <li>Shadow mode zaznamenává bez držení, první týden vás tedy nic nestojí.</li>
            </ul>
            <Link href="/docs/quickstart" className="link-arrow" data-testid="link-cs-docs">
              Přejít na quickstart
              <Icon name="arrowUpRight" size={15} />
            </Link>
          </Reveal>
        </div>
      </Section>

      <Section id="cs-classes" index="04" label="TŘÍDY">
        <SplitHeading text="Znát třídu dřív než volání." className="h2" />
        <p className="lede mt-sm">
          VOID neslibuje, že vše půjde vrátit. Slibuje, že budete vědět, v jaké třídě jste, ještě než agent
          jedná, a že R3 stojí rozpočet.
        </p>
        <div className="class-list mt-lg">
          {csClasses.map((row) => (
            <div className="class-row" key={row.id}>
              <div className="class-trigger" style={{ cursor: "default" }}>
                <span className="class-dot" style={{ background: toneVar[row.id], color: toneVar[row.id] }} />
                <strong>{row.title}</strong>
                <span className="class-copy">
                  <b>{row.subtitle}</b>, {row.body}
                </span>
                <span />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="cs-faq" index="05" label="OTÁZKY">
        <SplitHeading text="Nepříjemné otázky, přímé odpovědi." className="h2" />
        <div className="faq-list mt-lg">
          {csFaq.map(([question, answer], index) => (
            <details className="faq-row" key={question} open={index === 0}>
              <summary className="faq-trigger" style={{ listStyle: "none" }} data-testid={`button-cs-faq-${index}`}>
                <span>{question}</span>
                <b aria-hidden="true">+</b>
              </summary>
              <div className="faq-answer-inner">{answer}</div>
            </details>
          ))}
        </div>
      </Section>

      <Section id="cs-access" index="06" label="PŘÍSTUP">
        <SplitHeading text="Nechte agenty jednat. Ponechte si zpět." className="h2" />
        <p className="lede mt-sm">
          Privátní beta pro platformní a compliance týmy, které provozují agenty v produkci.
        </p>
        <Reveal className="row mt-md">
          <Link href="/#access" className="btn btn-primary btn-lg" data-testid="link-cs-cta">
            Požádat o přístup
            <Icon name="arrow" size={16} />
          </Link>
          <Link href="/" className="btn btn-ghost btn-lg" data-testid="link-cs-en">
            English version
          </Link>
        </Reveal>
        <p className="mono mt-md">
          VOID je produktový koncept. Čísla na této stránce jsou ilustrativní.
        </p>
      </Section>
    </>
  );
}
