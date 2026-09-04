# VOID: go to market and business plan

How to take the product described in `BUILD-PLAN.md` and built by
`EXECUTION-PLAN.md` to a global market, and what has to be true for it to make
money. Written 4 September 2026, against the market as it stood that week.

Numbers marked *assumption* are assumptions. They are here so they can be
argued with, not because they are known.

> **CONFIDENTIAL. This file must not be in a public repository.**
>
> It contains pricing strategy, revenue and cost projections, funding plans and
> acquirer analysis. This repository is private today. The open core strategy in
> section 3 requires making it public. **Remove this file before that happens**,
> and move it somewhere private that is still versioned.

---

## 1. The position, in one line

**VOID is the open reversibility layer for AI agents: it classifies every tool
call against the state of its target before the call, holds the ones that
cannot be undone, and keeps a signed record anyone can verify without trusting
us.**

Against each neighbour:

| Neighbour | What they do | What VOID does that they do not |
| --- | --- | --- |
| Rubrik Agent Cloud and Agent Rewind | Monitor, govern with natural language policy, undo via their own snapshot platform. Now supports Claude Code and Claude Cowork. Enterprise, sales led, pricing not public. | Vendor neutral and open source. Class as a function of target state. Blast radius measured, not estimated. A budget for irreversibility. A ledger verifiable offline by a third party. Works for a three person team. |
| MCP gateways (MintMCP, Composio, the ex Portkey inside Palo Alto) | Intercept, allow or deny, approve in Slack, audit log. | A third decision (hold). What undoes what, and whether it still can. Compensation, not just refusal. |
| Durable execution (Temporal, Restate, DBOS, Inngest) | Saga and compensation as a programming model. | No code change to the agent. The registry decides what the compensation is. Classification before the call. |

The honest read: **the category is real, crowded, and consolidating.** Palo
Alto bought Portkey in May 2026. Rubrik launched an agent operations platform
and extended it to Claude Code in June 2026. Those are not reasons to stop.
They are proof that buyers exist, and a map of where the incumbents cannot go:
the developer who will never get a Rubrik quote, the tool surface Rubrik does
not snapshot, and the proof an auditor can check without a vendor login.

---

## 2. The market, with sources

| Signal | Number | Source |
| --- | --- | --- |
| Agentic AI governance and guardrails | USD 610M in 2025, USD 6.85B by 2032, 41 percent CAGR | MarketsandMarkets |
| Agentic AI security | USD 1.65B in 2026, USD 13.52B by 2032, 42 percent CAGR | MarketsandMarkets |
| Enterprise apps embedding task agents | Under 5 percent in 2025, 40 percent by end 2026 | Industry survey, via Azumo |
| Spend on AI tools versus securing AI | 17 to 1 | Software Strategies, March 2026 |
| Guardian agents share of agentic market by 2030 | 10 to 15 percent | Gartner, via MarketsandMarkets |

What those numbers mean for a small company: the segment is growing faster
than any incumbent can cover it, and the 17 to 1 spend gap is the buyer's
guilt. VOID does not need a percent of a billion dollar market. It needs a few
hundred teams who run agents against systems they cannot afford to break.

The demand side changed again this week. GPT-6 Astra shipped with autonomous
computer use and OpenAI placed it at the critical cybersecurity threshold in
their own framework. The first customers are enterprises in a trusted access
programme, precisely the people who will be asked "what did it do, and can you
take it back". That question is the sales call.

---

## 3. Business model: open core, with a hard line

**Open, Apache 2.0:** the proxy, both transports, the registry data and
evaluator, the ledger, the CLI, the standalone verifier, and the Postgres and
S3 connectors. Everything a solo developer needs to protect one system and
prove it.

**Paid:** the hosted control plane, approvals in Slack and Teams, SSO,
multiple workspaces, irreversibility budgets, the taint graph, signed
attestation exports mapped to compliance frames, premium connectors (Stripe,
Salesforce, HubSpot, Gmail, Kubernetes), retention beyond seven days, SLA
support, and the self hosted enterprise licence.

Why the line sits there:

1. **A security layer that sees every write has to be readable.** Nobody puts
   a closed proxy in front of their production database on a stranger's word.
2. **The registry is a community asset and a distribution engine.** Every
   entry is a page someone searches for. Every contributor is a user.
3. **The paid tier is what a team needs and an individual does not.** Approval
   channels, SSO, budgets and exports are organisational features. That is the
   right place for the line, and it does not move.
4. **Distribution through the MCP registry is free** and it only works for
   something people can install without a sales call.

The rule that keeps this from becoming a licence change story later: **the
open packages are complete for their purpose.** A feature is never moved from
open to paid. New organisational features land paid; the open core only grows.

---

## 4. Pricing

Global from day one means **USD as the primary currency**, with EUR shown for
EU visitors by geolocation. The site prices in EUR today and that changes
before launch.

| Tier | Price | Included | For |
| --- | --- | --- | --- |
| **Dev** | $0 | 10k protected actions a month, local ledger, all open connectors, 1 workspace, community | One person, one system |
| **Team** | $499 a month | 1M protected actions, hosted control plane, Slack and Teams approvals, signed export, 7 day retention, 8 hour support | A team running agents against production |
| **Business** | $1,990 a month | 5M actions, SSO, irreversibility budgets, taint graph, attestation with frame mappings, 3 premium connectors, 90 day retention, 4 hour support | A platform team owning agent safety for the company |
| **Enterprise** | from $40,000 a year | Self hosted or dedicated, bring your own KMS, air gapped option, unlimited connectors, audit support, onboarding | Regulated, or large |

Overage: $0.60 per thousand protected actions on Team and Business. A
protected action is one intercepted write that reached classification, so
reads are free and shadow mode is free, which is what lets a team turn it on
without a budget conversation.

**Unit economics.** A ledger entry is about a kilobyte. A million actions is a
gigabyte a month in Postgres. Snapshots live in the customer's bucket. The
marginal cost of a Team customer is under $20 a month before support, so gross
margin on software is above 90 percent and the blended figure after support is
*assumption* 80 to 85 percent.

**The benchmark.** MintMCP starts at $49 a month, Portkey's Pro tier sat at
$499, Composio is usage based from zero. Team at $499 is priced as an
infrastructure line item, not a developer tool, because the buyer is the
person who gets paged when the agent deletes something. The Dev tier is where
the developer tool comparison happens, and it is free.

---

## 5. Who buys, in order

**1. AI native startups running agents against production.** Ten to fifty
people, Claude Code or Cursor or a custom loop, a Postgres they care about,
already had one incident or read about one. They find VOID on GitHub or the
MCP registry, install the Dev tier in an afternoon, and convert to Team when
the second engineer needs to approve a hold. Fastest to close, lowest revenue
per account, the source of every case study.

**2. Platform and infrastructure teams at mid market software companies.**
Two hundred to two thousand people. They are being asked to "make the agents
safe" by a CTO who read about Astra. They want a policy file in git, SSO, and
a number for the board. Business tier, six week sales cycle, the first
reference customers that unlock segment three.

**3. Regulated EU enterprises.** Financial services under DORA since January
2025, anyone shipping a high risk system under the AI Act with Article 12
applying from 2 August 2026 (a delay to December 2027 is proposed and in
trilogue, not law). They buy the attestation export and the self hosted
option, and they buy through a partner. Enterprise tier, six to nine month
cycle, the revenue that makes the company durable.

**4. MSPs and consultancies deploying agents for clients.** They need to show
each client a record. A reseller motion, later.

Segment one funds the content and the credibility. Segment two funds the
company. Segment three is where the money is and it is not reachable without
one and two.

---

## 6. Geography: where, in which order, and why not here first

**United States first.** It is where agent adoption is highest, where the
budgets are, where the incumbents sell, and where every relevant conference,
newsletter and community is. English only product, English only content, USD
pricing. Sixty percent of revenue in the first two years, *assumption*.

**European Union second, through compliance.** The AI Act and DORA give the
EU a wedge the US does not have: a regulator who will ask for the record. The
attestation export with frame mappings is the EU product. Twenty five percent
of revenue, *assumption*, with Germany, the Netherlands and the Nordics ahead
of the rest because that is where the platform teams are.

**United Kingdom alongside the EU**, same product, different frames, no AI
Act. Then **Singapore and Australia** in year two, English speaking, strong
financial services regulation, reachable from the same content. **Japan** only
with a partner and localisation, year three at the earliest.

**Czech Republic is where the company is built, not where it is sold.** The
domestic market for this product is a handful of companies and every one of
them reads English documentation. Selling locally first would mean translating
a product for buyers who do not need it translated, at the cost of the market
that does. Prague is the engineering base, which is a cost advantage, and that
is its role. Productboard and Mews are the precedent: engineering at home,
headquarters where the customers are.

Practicalities of selling globally from Prague:

- **Time zones work in your favour.** Prague afternoon is the US East Coast
  morning. A single founder can cover US business hours until early evening
  local time and the EU morning before that.
- **Support hours** on Team are business hours in Prague plus the US East
  morning, stated on the pricing page. Enterprise gets what the contract says.
- **Data residency.** EU and US regions for the hosted control plane from the
  start, because the first EU enterprise will ask and the answer cannot be
  "later".

---

## 7. Company structure

This is direction, not legal or tax advice. Every line below needs a Czech
accountant and a US formation lawyer to confirm for your situation.

**The standard shape for a Czech founder selling to the world:** a Delaware
C corporation as the parent, holding the IP and the customer contracts, with a
Czech s.r.o. as a subsidiary that employs the engineering team and bills the
parent at cost plus a margin.

Why a US parent:

- US enterprise procurement and US investors both expect a Delaware entity.
  Neither will do the work to understand a Czech one.
- Marketplaces (AWS Marketplace is the relevant one, and Rubrik Agent Cloud is
  already listed there) and payment processors are simplest with a US entity.
- Option grants for future hires follow a template every lawyer knows.

How: Stripe Atlas forms a Delaware C corp for a one time $500 including the
EIN, founder shares and 83(b) filing, then about $100 a year for the
registered agent, plus Delaware franchise tax and an annual report you pay
separately. It is the default path for non US founders in every major
accelerator.

The Czech side: the s.r.o. is where you are employed and where the work is
done. Expect to deal with transfer pricing documentation, Czech CFC rules and
VAT on the intercompany invoice. This is routine for accountants who work with
startups and expensive for ones who do not, so pick the former.

**Payments.** For self serve Team and Business, use a merchant of record
(Paddle or a similar service) so US sales tax and EU VAT are handled by them
and the company invoices nothing by hand. Enterprise contracts are invoiced
directly from the Delaware entity. Switch self serve to direct Stripe billing
only when the fee difference exceeds the cost of a tax compliance service.

**Compliance you will be asked for.** SOC 2 Type I within twelve months of the
first Business customer, Type II a year after. Budget $10,000 to $20,000 a
year for the automation platform and the auditor. A GDPR data processing
agreement and a subprocessor list from day one, because the first EU customer
asks for it before the demo ends.

---

## 8. Channels, ranked by expected return for the money

### 8.1 The registry as the content engine

The single biggest marketing asset is already built, and it is not a blog.
Every registry entry answers a question somebody types into a search box:
"is deleting an S3 object reversible", "can you undo a Stripe payout", "does
Salesforce have a recycle bin for API deletes". Today they are rows in a
table. They become:

- **One page per entry** at `/registry/<id>`, with the cases, the inverse, the
  window and the note, indexed. A few hundred pages of long tail search
  traffic from people who have exactly the problem VOID solves.
- **A weekly reversibility report:** one entry, explained properly, with the
  precondition that changes the class, published to the site, to LinkedIn and
  to X, and sent to the newsletter. Fifty two a year, each one shareable by
  the engineers who got burned by that exact call.
- **Public incident classification.** When an agent incident makes the news
  (and with Astra in the wild they will), publish the chain of calls with
  VOID's classification of each: what was R0, where it went R3, where a hold
  would have stopped it. This is the most credible content the company can
  produce and it costs one afternoon each.
- **Contributions.** A `CONTRIBUTING.md` for registry entries, with the
  schema and the review bar. Every contributor becomes a user and an
  advocate, and every accepted entry is a page.

### 8.2 Distribution where developers already look

- **The official MCP registry** at registry.modelcontextprotocol.io. VOID is
  listed as a proxy that wraps any server. This is free, it is where MCP
  clients look, and the listing manifest is part of WP-15.
- **GitHub.** The repository is the product page for segment one. README with
  the five minute quickstart, a GIF of a hold being cancelled, the registry
  stats, and a link to the standalone verifier. Stars are vanity; the metric is
  installs that reach a first hold.
- **npm** for `void`, `void-verify`. **Docker Hub** for the sidecar image.
- **Client directories:** Claude Code plugin listing, Cursor and Windsurf
  integration pages, the Vercel AI SDK and LangGraph integration pages once
  WP-14 ships.
- **AWS Marketplace** once the Enterprise tier exists. Astra is on Bedrock,
  Rubrik is listed, and an enterprise buyer with committed AWS spend can pay
  for VOID through it without a new vendor onboarding.

### 8.3 Launches

Three, in this order, each tied to a build milestone:

| Launch | When | Where | The line |
| --- | --- | --- | --- |
| **The registry** | After WP-04b, before the product | Show HN, r/mcp, LinkedIn, X | "A registry of what undoes what, for AI agent tool calls. 250 calls, 35 vendors, and 80 percent of them change class depending on how the target is configured." |
| **VOID 0.1, open source** | After WP-15 | Show HN, Product Hunt, the MCP registry, newsletters | "An open proxy that holds the tool calls your agent cannot undo, and proves it." |
| **VOID Cloud** | After WP-11 with five design partners live | Blog, the design partners' own posts, targeted outreach | "Approvals, budgets and a signed record for every agent in the company." |

The registry launches first and alone because it is the lowest risk and the
most shareable thing the company has, and because it establishes the thesis
before there is a product to judge. If the registry launch produces nothing,
that is the cheapest possible signal that the positioning needs work.

Show HN mechanics that matter: Tuesday to Thursday, early US morning, a
title that states a fact rather than a claim, the author present in the
thread for six hours answering every technical question directly. Product
Hunt the same days, support mobilised in the first four hours.

### 8.4 Design partners

Five companies, chosen from segment one and two, before the product is
finished:

- They get Business tier free for six months and a direct line.
- You get a thirty minute call every week, honest feedback, and, if the
  results are real, a written case study and permission to name them.
- Only real logos, only real quotes, only real numbers. The site today is
  careful to label everything illustrative, and the first customer content
  is where that discipline pays off.

Where they come from: teams posting about agent incidents on X and in the
Claude and Cursor communities, MCP server maintainers who see the writes
going through their servers, companies in the most recent Y Combinator
batches building agents (the batch lists are public), and fintechs in the EU
under DORA who have a platform team and a compliance officer who talk.

### 8.5 Partnerships that compound

- **MCP server authors.** Every server that documents "works behind VOID" is
  a distribution channel. Start with the Postgres, AWS and Stripe servers,
  because those are the connectors.
- **Agent frameworks.** An integration page on the Vercel AI SDK, LangGraph
  and CrewAI documentation sites reaches every developer who uses them. This
  is what WP-14 is for commercially.
- **AI Act and DORA consultancies.** They need a technical answer to Article
  12 for their clients. VOID's attestation export is that answer, and the
  consultancy is the salesperson. Revenue share, not a reseller discount.
- **Model providers.** Anthropic and OpenAI both maintain partner directories
  and both have a stake in agents not destroying customer data. A listing is
  worth asking for once there are three named customers.

### 8.6 Events

Year one, attend, do not sponsor: AI Engineer World's Fair for segment one,
KubeCon for segment two, and one security conference (RSA or Black Hat) to
learn how the security buyer talks, because that is who signs the Enterprise
contract. Web Summit or a similar EU event only if a design partner is
speaking. Sponsorship is a year two decision, made on the basis of which
event the first ten customers actually came from.

### 8.7 What not to spend on

Paid search and paid social before there are ten paying customers. The
audience is small and finds things through the channels above; ads reach
people who do not have the problem yet. Analyst relations before $1M ARR.
Translation of the product or documentation into any language, including
Czech. A sales hire before ten customers have been closed by the founder,
because the founder needs to learn the objections first.

---

## 9. The first ninety days after WP-05

Aligned to the build so marketing never promises something the product cannot
show.

**Days 1 to 30, foundation.** WP-04b runs, the registry reaches roughly 250
entries and gets its per entry pages. The site's pricing switches to USD and
gains the Business tier. The Delaware entity is formed and the merchant of
record account opened. The newsletter exists with a first issue. Outreach to
twenty candidate design partners begins with a working demo of the hold.

**Days 31 to 60, registry launch and alpha.** Show HN for the registry. Five
design partners signed and running the Dev tier through WP-06 and WP-07.
Weekly reversibility report starts. The first public incident classification
is published when the first suitable incident happens.

**Days 61 to 90, open source launch.** WP-09 and WP-15 ship 0.1. Show HN and
Product Hunt for VOID itself. MCP registry listing live. Two design partner
case studies drafted. Team tier open for self serve.

The measure at day ninety: **ten teams that have reached a first hold on a
real system, and two that have asked what Business costs.** Not stars, not
signups.

---

## 10. Sales motion

**Product led for Dev and Team.** Install, reach a hold, invite a colleague,
hit the workspace limit, pay by card. No demo, no call. The conversion event
to watch is the second approver, because a hold nobody else can see is a
personal tool, and a hold a colleague cancels is a team tool.

**Sales assisted for Business.** A demo on request, a fourteen day trial with
the founder on a shared channel, a policy file written together during the
trial. Close on the number for the board: irreversible actions attempted,
held, and cancelled, per agent, per month.

**Founder led for Enterprise.** Design partners become the first three. A
paid pilot of $10,000 to $25,000 for ninety days on their own infrastructure,
converting to an annual contract with the pilot fee credited. Security
questionnaire answered from the SOC 2 work. The partner consultancy in the
room for the EU deals.

**Metrics, in the order they matter:**

| Metric | Why it matters |
| --- | --- |
| Time to first hold | If it is over five minutes the quickstart is broken |
| Weekly active proxies | The only real adoption number |
| Protected actions per week | The usage the price is built on |
| Second approver added | The conversion signal |
| Free to Team conversion | *Assumption* 1 to 2 percent of active proxies |
| Team to Business | *Assumption* 20 to 30 percent within a year |
| Net revenue retention | Above 110 percent means the usage pricing works |

---

## 11. Financial model, twenty four months

Three scenarios at month 24. All of it is *assumption*, and the base case is
the one the plan is written for.

| | Conservative | Base | Upside |
| --- | --- | --- | --- |
| Active free proxies | 1,500 | 6,000 | 20,000 |
| Team customers | 12 | 40 | 120 |
| Business customers | 3 | 12 | 35 |
| Enterprise customers | 1 | 4 | 12 |
| MRR | $15,300 | $57,200 | $169,500 |
| ARR | $184,000 | $686,000 | $2,030,000 |

Arithmetic for the base case: 40 × $499 plus 12 × $1,990 plus 4 × $40,000
divided by twelve, which is $19,960 plus $23,880 plus $13,333.

Costs, base case, per month:

| Item | Months 1 to 6 | Months 7 to 12 | Months 13 to 24 |
| --- | --- | --- | --- |
| Founder, minimal salary via the s.r.o. | $3,000 | $3,000 | $4,000 |
| Model spend (from `BUILD-PLAN.md`) | $700 | $700 | $900 |
| Infrastructure, two regions | $150 | $400 | $1,200 |
| Merchant of record fees, about 5 percent of self serve | $0 | $500 | $2,500 |
| Compliance (SOC 2 platform and audit, amortised) | $0 | $1,200 | $1,500 |
| Legal, accounting, entities | $600 | $600 | $800 |
| Second engineer, from month 13 | $0 | $0 | $7,000 |
| **Total** | **$4,450** | **$6,400** | **$17,900** |

In the base case the company covers its costs around month twelve to fourteen
and is profitable on paper before the second hire. In the conservative case it
covers costs at around month twenty and the second hire waits. In the upside
case it is time to raise, because demand is outrunning one person.

The first year needs roughly $65,000 of runway if nothing is raised, most of
it the founder's own salary. That is the real cost of building this: a year
of modest income, not a large cheque.

---

## 12. Funding: when, and whether

**Bootstrap to the first ten paying teams.** The cost is small, the leverage
of having revenue before a fundraising conversation is large, and a solo
founder in a crowded category raising on a deck will get a bad price or no
price.

**Decide at month nine.** With ten paying customers, two case studies and a
growing registry, there are three honest options:

1. **Stay bootstrapped**, add enterprise services revenue (paid pilots,
   implementation) and grow to the base case with one hire. Slower, fully
   owned, and viable because the margins are high.
2. **Raise a pre seed of $500,000 to $1,500,000** from funds that back AI
   infrastructure, in the US or the EU. This buys a US based go to market
   hire and a second engineer, and it is the path to the upside case. Expect
   the conversation to be about the incumbents; the answer is section 1 and
   the registry stats.
3. **Take a strategic angel cheque** from someone inside the MCP or agent
   framework ecosystem, smaller money and a much bigger network.

A technical co-founder or a US based commercial co-founder changes the odds
of option 2 more than any other single factor. Worth an active search from
month three, not a passive hope.

---

## 13. Exit paths, so the company is built to have one

Three years out, the plausible acquirers, with the precedent for each:

- **Security platforms.** Palo Alto bought Portkey for the gateway. The same
  logic applies to CrowdStrike, Zscaler, Wiz within Google, Cloudflare and
  Datadog: a reversibility layer with a public registry and a verifiable
  ledger is a product line they cannot build quickly and their customers are
  asking for.
- **Resilience and backup vendors.** Rubrik, Cohesity, Veeam. VOID is the
  vendor neutral half of what Agent Rewind does; for one of Rubrik's
  competitors it is the fastest way to answer Rubrik.
- **Agent platforms and model providers**, if the registry becomes the
  reference for tool safety.

What makes the company worth buying rather than copying: the registry with
its community and search presence, the ledger format that customers' auditors
have already accepted, and a customer list in regulated industries. Those are
the assets to build even when they do not show up in this quarter's revenue.

---

## 14. Risks, and the response to each

| Risk | Response |
| --- | --- |
| Rubrik or a hyperscaler bundles a hold and an undo for free | Stay open, stay neutral, and stay on the surfaces they do not snapshot. Make the registry the thing everyone cites, including them. |
| Agent frameworks ship native approval hooks | The hold is commoditised; the registry, the ledger and the class are not. Integrate with the hooks rather than competing with them. |
| MCP changes under the product | Thin transport layer, fast adoption of spec changes as content ("what changed and what it means for your writes"). |
| The EU delays the AI Act to 2027 | The EU wedge gets slower, DORA does not move, and the US does not care either way. Weight the plan to the US as it already is. |
| One founder, two continents | Ruthless scope, a co-founder search from month three, and no sales hire until the founder can write the objection list from memory. |
| Enterprise sales cycles outlast the runway | Enterprise is segment three for a reason. Team and Business fund the wait. |
| A design partner has an incident VOID did not prevent | Publish the classification honestly, fix the registry entry, ship the connector. The company's credibility is the honesty of the registry. |

---

## 15. The next five actions

1. Change the pricing page to USD and add the Business tier, so the site
   matches this plan before anyone from a launch sees it.
2. Form the Delaware entity and open the merchant of record account, so
   there is somewhere for money to go by the time WP-05 ships.
3. Write the design partner offer as one page and send it to twenty teams
   with a screen recording of the hold from WP-05.
4. Start the newsletter with the first reversibility report, using an entry
   that already exists.
5. Draft the Show HN post for the registry now, and refine it every week
   until WP-04b lands.

---

## Sources

- [Agentic AI Governance Guardrails Market, MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/agentic-ai-governance-guardrails-market-156785354.html)
- [Agentic AI Security Market, MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/agentic-ai-security-market-97017233.html)
- [Information Security Spending 2026, Software Strategies](https://softwarestrategiesblog.com/2026/03/24/information-security-spending-2026/)
- [AI Agent Statistics 2026, Azumo](https://azumo.com/artificial-intelligence/ai-insights/ai-agent-statistics)
- [Rubrik Agent Cloud for Claude Code, SiliconANGLE](https://siliconangle.com/2026/06/09/rubrik-brings-agent-cloud-claude-launches-rubrik-ai-automate-recovery/)
- [Rubrik Agent Cloud on AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-dh3puqbvma3c4)
- [Rubrik Agent Cloud product page](https://www.rubrik.com/products/rubrik-agent-cloud)
- [Portkey pricing and the Palo Alto acquisition, TrueFoundry](https://www.truefoundry.com/blog/portkey-pricing-guide)
- [Best MCP Gateways for AI Startups 2026, MintMCP](https://www.mintmcp.com/blog/gateways-ai-startups-with-mcp)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/)
- [Introducing the MCP Registry, MCP blog](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)
- [Stripe Atlas review 2026, Rho](https://www.rho.co/blog/stripe-atlas-review)
- [Stripe Atlas in 2026, unil.ink](https://unil.ink/help-center/articles/stripe-atlas-2026)
- [GPT-6 Astra model reference, OpenAI](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [OpenAI begins rolling out Astra, CNBC](https://www.cnbc.com/2026/09/03/open-ai-astra-gpt-6-cyber.html)
- [Article 12: Record keeping, EU AI Act](https://artificialintelligenceact.eu/article/12/)
