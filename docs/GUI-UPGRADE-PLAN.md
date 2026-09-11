# VOID — plán velkého upgradu GUI

Datum: 2026-09-11. Stav: **implementace nasazena; výsledky a otevřené ověření viz [předání](GUI-UPGRADE-DELIVERY.md)**. Výchozí audit: [GUI-UPGRADE-AUDIT.md](GUI-UPGRADE-AUDIT.md). Tento dokument zachovává původní zadání a akceptační cíle. Skutečně dodaný rozsah a dosud neprovedené kontroly rozlišuje předávací dokument.

## 1. Cíl a pevná rozhodnutí

Vytvořit plnohodnotný webový pracovní prostor na Vercelu. Pohodlí konverzací, historie a práce s dokumenty se má přiblížit claude.ai; transparentnost modelů, nástrojů a běhu agenta OpenCode. Zachovat specifickou hodnotu VOID: u každé důležité operace vidět stav, důvod rozhodnutí, důkaz a skutečnou možnost vrácení.

„Všechno důležité“ znamená úplné pokrytí entit a jejich historie, dostupné filtrováním a detailem. Neznamená zobrazit všechna data současně v chatu. Chat je primární pracovní plocha; přehledy, tabulky a inspektor poskytují potřebnou hloubku.

Pevné požadavky:

1. Jeden společný shell, stabilní navigace a adresovatelné konverzace.
2. Samostatně navržená desktopová, tabletová a mobilní kompozice.
3. Výchozí nová konverzace: **TokenRouter / GLM 5.3 Free**.
4. Bohaté zprávy, průběžné odpovědi, interaktivní tool cards, dokumenty a diff.
5. Přehled všech konverzací, běhů, nástrojů, konektorů, modelů, schválení, změn a ledgeru.
6. Úplná dostupná historie se serverovým vyhledáváním, stránkováním a exportem; viditelně přiznaná starší chybějící data.
7. Skutečné stavy loading/empty/error/offline/stale/permission-required. Neznámé metriky nejsou nuly.
8. Zachovat bezpečnostní a auditní vlastnosti, lokální runtime a desktopové balení.
9. Každá etapa má funkční výstup, konkrétní test a podmínku dokončení. Základní MVP není konečný cíl tohoto zadání.

## 2. Vizuální směr

Navázat na aktuální požadavek zaznamenaný v `docs/GUI-RULES.md`: identita VOID / paper-terminal / ASCII. Převzít pracovní návyky referenčních aplikací, nikoli jejich branding. Hlavním vizuálním motivem je drobný ASCII znak a čitelná historie akcí, ne dekorativní panely.

| Token | Light | Dark | Použití |
|---|---|---|---|
| Canvas | `#f6f0e3` | `#12100a` | Hlavní pracovní plocha |
| Surface | `#efe8d8` | `#1a1610` | Sidebar, hlavičky tabulek, inspektor |
| Surface raised | `#e6ddc9` | `#241f16` | Vybrané prvky a vrstvy |
| Text | `#17150f` | `#f0eade` | Primární text |
| Text muted | `#6f6857` | `#b1a68f` | Sekundární metadata |
| Action | `#bd4206` | `#e8702c` | Aktivní stav a hlavní akce |

Hranice, focus a semantické barvy odvodit z existujících CSS proměnných. Kontrast změřit pro reálné kombinace; malé texty alespoň 4,5:1, velké texty a nezbytné UI grafiky alespoň 3:1. Barva nikdy není jediný nositel stavu.

Typografie: systémový sans pro běžné UI a zprávy, současný monospace pro kód, identifikátory a krátké technické štítky. Serif pouze ve welcome a výrazných titulcích; v datových stránkách malé funkční nadpisy. Text zpráv 17/26 px, UI 14–16 px, doplňující metadata 12–13 px. Velké přehledy nesmí být celé drobným monospace písmem.

Rozměry: spacing 4/8/12/16/24/32 px; ovladače 44 px, na mobilu preferovat 48 px. Rohy 2 px na tabulkách, 4–6 px na formulářích a dialogu. Kompaktní datové řádky mohou mít 40 px, samostatné dotykové akce stále 44 px. Bez dekorativních gradientů. Pohyb 120–180 ms jen jako odpověď na akci; respektovat reduced motion.

## 3. Informační architektura

| Plocha | Hlavní účel | Výchozí obsah |
|---|---|---|
| Chat | Práce s agentem | Aktivní konverzace, composer, model, průběh |
| Přehled | Stav celého workspace | Co běží, co čeká na uživatele, poslední změny, stav připojení |
| Konverzace | Správa historie | Vyhledat, přejmenovat, připnout, archivovat, otevřít, exportovat |
| Běhy a aktivita | Provoz agenta | Timeline a tabulka modelových a nástrojových kroků |
| Dokumenty | Výstupy práce | Strom/seznam dokumentů, obsah, verze, diff, export, Undo |
| Schvalování | Operátorská rozhodnutí | Čekající, odeslané, vyřešené a expirované požadavky |
| Ledger | Auditní evidence | Stránkovaná podepsaná historie, verifikace a vazby |
| Nástroje a konektory | Dostupné schopnosti | Připojení, tool katalog, klasifikace, stav, politika |
| Modely a spotřeba | Výběr a kontrola providerů | Modely, výchozí volba, limity, usage a doložené náklady |
| Nastavení | Osobní a workspace preference | Vzhled, chování chatu, providery, připojení, exporty |

Sidebar: nahoře workspace picker, „Nová konverzace“ a globální hledání. Potom hlavní plochy; pod nimi připnuté a nedávné konverzace. Dole připojení, nastavení a účet/session. U schvalování badge s počtem čekajících. Běžící konverzace je rozpoznatelná bez vstupu do ní.

Chat, přehled a ledger nesmí mít vzájemně odlišné názvy navigace. UI texty centralizovat, výchozí čeština, volitelná angličtina; názvy API/modelů a obsah konverzací nepřekládat. Datum a čísla formátovat podle locale.

## 4. Desktopový a mobilní layout

### Desktop od 1280 px

```text
┌────────────────┬──────────────────────────────────┬───────────────────┐
│ VOID workspace │ Konverzace / projekt   stav       │ Kontext           │
│ Nový chat      ├──────────────────────────────────┤ Dokumenty         │
│ Hledat         │                                  │ Nástroje          │
│                │ Zprávy, Markdown, kód            │ Změny / diff      │
│ Přehled        │                                  │ Podrobnosti běhu  │
│ Konverzace     │ Sbalitelné nástrojové kroky       │                   │
│ Aktivita       │                                  │                   │
│ Dokumenty      │                                  │                   │
│ Schvalování 2  ├──────────────────────────────────┤                   │
│ Ledger         │ Přílohy / vybraný kontext         │                   │
│ Modely         │ Napište zprávu…                   │                   │
│                │ GLM 5.3 Free · TokenRouter  Poslat│                   │
│ Nedávné chaty  ├──────────────────────────────────┴───────────────────┤
│ Nastavení      │ Stav spojení / skutečný běh / poslední aktualizace   │
└────────────────┴──────────────────────────────────────────────────────┘
```

Sidebar výchozí 248 px, povoleně 216–300 px; sbalený 64 px. Chat používá `minmax(0,1fr)`, textový sloupec 720–820 px a je vycentrovaný uvnitř pracovní plochy. Inspektor otevřený na vyžádání, výchozí 360 px, rozsah 320–520 px. Resize má klávesnicovou alternativu. Šířky se ukládají lokálně a omezují podle aktuálního viewportu.

Celý shell má `height:100dvh`, vnořené plochy `min-height:0`. Scrolluje transcript, sidebar a inspektor nezávisle; composer patří do neodscrollovatelného spodního řádku chatu. Na datových stránkách scrolluje obsah tabulky, toolbar zůstává dostupný. Marketingový hero a dlouhý footer uvnitř aplikace odstranit.

### Tablet 768–1279 px

Výchozí úzký sidebar 64 px, rozbalení jako overlay. Inspektor se otevírá přes obsah nebo jako samostatná plocha podle dostupné šířky. Neumísťovat ho pod dlouhý transcript. Když chat nemá alespoň 480 px, otevřít dokument místo něj a nabídnout jasný návrat. Ověřit šířky 768, 834, 1024 i landscape.

### Mobil 320–767 px

```text
┌───────────────────────────────────┐
│ Menu   Název konverzace     Kontext│ 56 px
├───────────────────────────────────┤
│                                   │
│ Zprávy a karty nástrojů            │
│                                   │ jediný scroll chatu
│ Nové zprávy: přejít dolů           │
├───────────────────────────────────┤
│ [příloha] [vybraný dokument]       │
│ Napište zprávu…                    │
│ GLM 5.3 Free               Poslat  │
├───────────────────────────────────┤
│ Chat    Přehled    Schválení  Více │ safe area
└───────────────────────────────────┘
```

Historie se otevírá v draweru; nikdy nezabírá první čtvrtinu chatu. Vyhledávání historie zůstává dostupné i na mobilu. Dokument nebo diff se otevírá jako celá obrazovka s návratem do stejné konverzace a stejného scrollu. Filtry tabulek otevírat v sheetu, zvolený filtr viditelně ukázat nad výsledky.

Composer: textarea automaticky 1–6 řádků s interním scrollem. Při virtuální klávesnici skrýt spodní navigaci a udržet composer nad klávesnicí. Primárně CSS `dvh` a safe-area; `visualViewport` použít jen pro reprodukovaný problém browseru. Draft i scroll přežijí otočení telefonu a otevření dokumentu. Na mobilu Enter vytvoří nový řádek; odeslání samostatným tlačítkem. Desktop má nastavitelný Enter/Cmd+Enter a respektuje IME composition.

Akceptace: na 390 × 844 px lze bez scrollování stránky začít psát a odeslat; historie je dostupná jedním kliknutím. Žádný horizontální overflow celé aplikace na 320 px. Kód a široké tabulky mohou mít vlastní označený horizontální scroll.

## 5. Chat a správa konverzací

### Zprávy

- Markdown s nadpisy, seznamy, odkazy, citacemi a tabulkami. Raw HTML zakázané nebo sanitizované. Odkazy mají kontrolovaný protokol.
- Kódové bloky: jazyk, kopírovat, zalamování, stažení; syntax highlighting načítaný podle potřeby.
- Akce zprávy: kopírovat, editovat uživatelskou zprávu, zkusit odpověď znovu, vytvořit větev od zprávy. Editace vytvoří novou větev, nezmění již existující auditní historii.
- Větvení z tool-heavy konverzace nikdy automaticky neopakuje historické side effects; dokumentový snapshot a opakování akcí jsou explicitní.
- Role user/assistant/tool jsou vizuálně odlišené. Timestamp a technické podrobnosti sekundární, ne nad každým odstavcem jako hlavní obsah.
- Průběžný text s indikátorem běhu. „Přemýšlení“ nevymýšlet; zobrazovat skutečné veřejné stavy a providerem podporovaná metadata.
- Autoscroll pouze při sledování konce. Při čtení historie badge „Nové zprávy“. Aktualizace nesmí zničit výběr textu.

### Composer

Jeden kompaktní výběr modelu s hledáním, oblíbenými a providerem. Přiložit dokument, vložit obsah, vybrat existující kontext. U příloh ukázat typ, velikost, stav zpracování a odebrání před odesláním. Režimy obrázků/PDF povolit podle skutečně ověřených schopností modelu; neprezentovat GLM jako multimodální bez důkazu.

Stop je skutečný požadavek na zastavení běhu. Rozlišit „Zastavuji“, „Zastaveno“ a „Dříve odeslaný nástroj ještě dokončuje práci“. Draft zachovat při chybě odeslání. Každé odeslání má idempotency klíč, aby reconnect či dvojklik nevytvořil duplicitní tah.

### Historie

Přejmenování, připnutí, archivace, obnovení a hledání podle názvu i obsahu. Skupiny dnes/včera/starší a projekt/štítek. Archivace nevypíná automaticky běžící práci. Mazání uživatelské historie není mazání podepsaného ledgeru; politiku retence vysvětlit samostatně.

Navržené URL: `/chat/new`, `/chat/:id`, `/overview`, `/sessions`, `/runs`, `/documents`, `/approvals`, `/ledger`, `/connections`, `/models`, `/settings`. Konkrétní dokument/record otevřít query parametrem nebo podcestou. Zpět/vpřed obnoví filtr, aktivní detail a draft. Existující `.html?workspace=` odkazy přesměrovat na odpovídající plochu se zachovaným workspace.

## 6. Přehledy a tabulky

Společná tabulka poskytne serverové hledání, řazení, cursor pagination, výběr sloupců, uložené pohledy, čitelný detail řádku, kopírování ID a export. Výchozí page size 50, volitelně 25/100. Při příchodu nových řádků zachovat pozici a nabídnout jejich vložení, ne přeskládat tabulku během čtení.

| Tabulka | Výchozí sloupce | Filtry / akce |
|---|---|---|
| Konverzace | Název, projekt, model/provider, stav, poslední změna, počet zpráv | Hledat, štítky, stav, období; připnout, archivovat, exportovat |
| Běhy | Session, run ID, stav, začátek, trvání, model, kroky, čekání | Běžící/čekající/chybové; detail, zastavit, přejít do chatu |
| Volání nástrojů | Čas, nástroj, konektor, klasifikace, rozhodnutí, výsledek, trvání | Session, nástroj, R0–R3, allow/hold/deny, výsledek, čas |
| Schvalování | Nástroj, důvod, workspace, riziko, expirace, stav, kdo rozhodl | Čekající/odeslané/vyřešené/expirované; detail a jednotlivé rozhodnutí |
| Dokumenty | Cesta, typ, velikost, revize, změněno, session | Hledat, typ, session; otevřít, porovnat, exportovat |
| Změny | Operace, dokument, čas, autor/nástroj, evidence, možnost Undo | Dokument, druh operace, session; preview, přejít na ledger |
| Ledger | Seq, čas, workspace, nástroj, třída, rozhodnutí, digest | Serverové filtry; ověřit, detail, vazby, podepsaný export |
| Konektory | Název, transport/endpoint, stav, počet nástrojů, poslední kontrola | Připojit, ověřit, upravit, odpojit |
| Nástroje | Název, konektor, schema, registry ID, třída, policy, Undo | Hledat, připojení, povolení, schopnosti; detail schématu |
| Modely | Název, provider, dostupnost, kontext, tool support, cena, default | Hledat, oblíbené, free, schopnosti; vybrat default |
| Spotřeba | Období, model, session, input/output/cache tokeny, náklad, zdroj ceny | Období, provider, model, session; export |

Mobil používá explicitní kompaktní řádek: hlavní název, stav, čas, jedna akce. Ostatní pole v detailu. Technická auditní tabulka může nabídnout přepínač „Tabulka / Seznam“; CSS nesmí záviset pouze na `nth-child` pořadí buněk.

Přehled workspace: nahoře konkrétní „Vyžaduje pozornost“ a aktuální běh; dále nedávné konverzace, změny a kompaktní stav služeb. Malé grafy jen pro skutečně sbírané tokeny, trvání a výsledky. Každý agregát uvádí období a scope a proklikne se do stejného filtrovaného seznamu. Nikdy počítat „celkem“ pouze z poslední načtené stránky.

## 7. Dokumenty, artefakty a změny

Inspektor má záložky Obsah, Změny, Nástroje, Běh. Dokumenty mají strom cest, vyhledávání, Markdown preview a přepnutí na zdroj. Kódový editor přidat jako lazy-loaded komponentu při potřebě editace; prostý preview nesmí stahovat celý editor.

Editace uživatelem vytvoří tutéž evidovanou operaci jako nástroj. Uložení používá očekávanou revizi; při souběžné změně nabídne diff, nepřepíše cizí verzi. Podpora malých textových příloh a importu patří do upgradu; větší soubory vyžadují oddělený upload tok a limity.

Diff: přidané/odebrané řádky, desktop split/unified, mobil unified. Akce „Vrátit změnu“ otevře preview s popisem dopadu a aktuální platností inverse. Po provedení zobrazit novou operaci a ledger záznam. Když Undo není možné, uvést konkrétní důvod a nepřidávat falešné tlačítko.

Vygenerované HTML/JS artefakty se zobrazují jen v izolovaném sandboxu, bez oprávnění originu aplikace a bez přístupu ke cookie/API. Bez sandboxu se zobrazí zdroj. Případné rozšíření CSP musí být omezené na tento use case.

## 8. Nástroje, schvalování a důkazy

Tool card: název, zdroj, stav queued/running/awaiting-approval/completed/failed/denied/cancelled, trvání, shrnutí vstupu a výsledku. Detail má JSON viewer, klasifikaci, zdroj klasifikace, policy rule, měřené/deklarované skutečnosti, record link a Undo capability. Citlivé argumenty a tajemství redigovat před persistencí eventu i před odpovědí API.

Schválení dostupné přímo u tool card a v inboxu. Jedno rozhodnutí, jeden idempotentní zápis; stav „odesláno“ zůstává do potvrzení workflow. Expirace se rozhoduje na serveru. Dvě otevřené karty nesmí povolit dvojí provedení. Batch schválení není výchozí; jednotlivé dopady musí být zřejmé.

Ledger detail odděluje: obsah záznamu, hash chain integrity, podpis, rozsah ověření, klíč a čas kontroly. Filtr/tabulková stránka není kompletní řetězec. Počet a rozsah ověřených záznamů musí odpovídat skutečnému proof, nikoli viditelným řádkům.

Vazby mezi voláními nabídnout jako jednoduchý graf s klávesnicově dostupným seznamem. Rozlišit evidovaný vztah od prokázané příčinnosti. Velké grafy načítat po okolí vybraného uzlu.

## 9. TokenRouter a GLM 5.3 Free

Ověřená lokální metadata z `/Users/dawe/.config/opencode/opencode.jsonc`:

```json
{
  "providerId": "tokenrouter",
  "providerName": "TokenRouter",
  "baseUrl": "https://api.tokenrouter.com/v1",
  "kind": "openai",
  "modelId": "z-ai/glm-5.3-free",
  "modelName": "GLM 5.3 Free",
  "openCodeSelectionId": "tokenrouter/z-ai/glm-5.3-free"
}
```

Implementace defaultu musí zasáhnout frontend, cloudový bootstrap a lokální workbench. Samotná změna popisku nebo `localStorage` nestačí.

1. Přidat TokenRouter do centrálního katalogu presetů, model default a capability metadata s informací o zdroji.
2. Persistovat nastavení nových konverzací na serveru: provider profile + model ID. Pro lokální režim v existujícím šifrovaném workspace storage.
3. Při prvním otevření nabídnout TokenRouter / GLM 5.3 Free. Chybějící credential zobrazit jako „Připojit TokenRouter“, nikoli automaticky přepnout na Gateway.
4. Pro cloud credential použít stávající šifrovaný provider profil nebo serverový `TOKENROUTER_API_KEY`; nepřidávat jej do frontendových env proměnných. Při realizaci převést existující lokální credential přes bezpečný serverový provisioning tok, bez logování a bez uložení do repozitáře. Tento plán jej nikam nekopíruje.
5. Ověřit `/models`, přesné model ID, krátkou generaci, tool call a streaming. Pokud katalog model nevrací, ověřit dokumentovaný způsob jeho dostupnosti; nedeklarovat připojení za funkční jen podle názvu v OpenCode.
6. API `model` posílat jako `z-ai/glm-5.3-free`, nikoli provider-prefixed OpenCode ID.
7. Nové sessions bez explicitního výběru používají tento default. Stávající sessions si zachovají snapshot modelu a providera.
8. Starý globální `void-model` migrovat na preference scoped podle workspace a provider profile; nesmí přebít nový serverový default náhodnou starší volbou. Explicitní novější uživatelská změna má přednost.
9. Při 429 respektovat Retry-After a zobrazit čekání; při 401 obnovu credential; při 403/404 nedostupný model. Žádný tichý přechod na placený model.
10. „Free“ zachovat v názvu. Cena 0 se zobrazí jen s doloženou tarifní informací; jinak „cena neověřena“. Neodhadovat context window nebo rate limits podle jiného GLM modelu.

Hotovo, když čistý browser i nové přihlášení na Vercelu ukazují správný default, generace funguje a původní konverzace zůstávají reprodukovatelné.

## 10. Technická architektura a změny souborů

### Rozhodnutí o frontendu

Doporučený cílový frontend: **React + TypeScript + Vite**, jako oddělená klientská aplikace v `apps/control-plane/ui`. Zachovat existující Node/Nitro, Vercel Workflow, workbench a podepsaný ledger. Pro tento interní pracovní prostor není doložený důvod k migraci celého backendu na Next.js.

Srovnání: postupné modulární rozšíření vanilla JS má nejnižší vstupní náklad, ale požadované větvení, sdílené filtry, streaming a velké tabulky už znamenají značnou vlastní správu stavu. React zde odůvodňují konkrétní sdílené komponenty. Next.js by přidal současnou migraci routingu a serverového lifecycle bez nutné produktové výhody.

Použít nativní CSS Grid, dialog a formulářové prvky. TanStack Table pro headless tabulky, pokud prototyp potvrdí přínos pro společné řazení/sloupce; TanStack Query pro deduplikaci a invalidaci API, protože více ploch pracuje nad stejnými entitami. Nepřidávat zároveň další globální store. Složitější combobox/menu vzít z jedné dostupné a otestované knihovny přístupných primitives, ne z několika vizuálních kitů. Markdown parser se sanitizací je odůvodněná závislost; nevytvářet vlastní parser.

Úvodní vertikální řez ověří bundle, CSP, lokální statické servírování a desktopové zabalení. Pokud neprojde, nejprve opravit integraci; framework nepřepínat automaticky uprostřed funkční implementace.

```text
apps/control-plane/ui/
  index.html
  src/main.tsx
  src/app/             shell, router, connection gate
  src/features/        chat, sessions, overview, documents, approvals,
                       ledger, connections, models, settings
  src/components/      DataTable, Dialog, Drawer, StatusBadge, EmptyState
  src/api/             client, events, typed response validation
  src/styles/          tokens, shell, components, responsive
```

Strom udává odpovědnosti, nikoli příkaz vytvořit prázdné soubory. Soubory přidávat až s implementovanou funkcí.

| Existující místo | Konkrétní změna |
|---|---|
| `web/index.html` a další HTML | Postupně nahrazeny společným shellem; staré URL zachovat redirectem |
| `web/workbench.css` | Přenést tokeny, odstranit duplicitní layoutová pravidla; nové responzivní plochy |
| `web/sessions.js` | Rozdělit odpovědnosti router/draft/model picker/transcript; zrušit plné přerenderování na timer |
| `web/app.js` | Přenést existující validační a decision pravidla do typed API a features |
| `web/workspace-ui.js` | Dokumentová revize, viewer/diff, invalidace podle skutečné změny |
| `web/cloud-settings.js` | Konektorový přehled a editace místo jediného dlouhého nastavení |
| `packages/workbench/src/provider.ts` | Streaming, normalizované usage, capability metadata, řízené chyby |
| `packages/workbench/src/index.ts` | Structured events, idempotence tahů, default preference, historie |
| `cloud/server.mjs` | Kontrakt nové navigace, stránkované seznamy, preferences, delta/event endpointy |
| `cloud/store.mjs`, `cloud/schema.sql` | Neztrátové events a read models; indexy podle skutečných dotazů |
| `cloud/steps.mjs`, `cloud/workflow.mjs` | Emise průběhu, usage a konečného výsledku při zachování durable orchestrace |
| `api/server.ts` | Parita lokálního API; bezpečné servírování build assets a SPA fallback |
| `scripts/src/build-web.mjs`, `nitro.config.ts` | Vite build do `dist/web`, asset hashing, route fallback mimo `/api` |
| `apps/desktop/scripts/prepare.mjs` | Balení stejného sestaveného webu včetně vnořených assets |
| `docs/GUI-RULES.md` | Nové závazné komponentové a responzivní zásady po implementaci |

Zastaralý web odstranit až po funkční paritě. CSS testy a testy pevné sady souborů upravit podle nového kontraktu, ne je prostě smazat.

## 11. Datový kontrakt a průběžné aktualizace

Dnes existující endpointy: provider GET/POST/DELETE, connectors GET/POST a DELETE dle ID, sessions list/create/detail/follow-up/cancel, workspace a undo, approvals/decision, feed, ledger verify/export, record taint/replay. To je výchozí kompatibilní vrstva.

Navržená rozšíření, která teprve vzniknou:

| API | Účel |
|---|---|
| `GET/PATCH /api/preferences` | Default provider/model, locale, appearance, chování chatu |
| `GET /api/capabilities` | Režim cloud/local, skutečné schopnosti a limity |
| `GET /api/sessions?cursor=&q=&status=&archived=` | Kompletní filtrovaná historie |
| `PATCH /api/sessions/:id` | Název, pin, archiv, projekt/štítky |
| `POST /api/sessions/:id/branches` | Větev od zprávy, se snapshotem a bez replay side effects |
| `GET /api/sessions/:id/events?after=` | Přírůstky a obnova po výpadku |
| `GET /api/sessions/:id/stream` | SSE nad persistovaným průběhem |
| `GET /api/runs`, `GET /api/usage`, `GET /api/overview` | Běhy a agregace se scope/obdobím |
| `GET /api/documents?...` | Přehled napříč dostupnými sessions |
| `GET/PATCH /api/sessions/:id/documents/...` | Obsah a editace s očekávanou revizí |
| Rozšířený `GET /api/feed` | Cursor, interval, filtry, řazení, count scope |
| Rozšířený `GET /api/approvals` | Historie rozhodnutí a vysvětlení politiky |

Každý seznam vrací `items`, `nextCursor`, `hasMore`, `asOf`, `scope`; případný `total` je přesný počet nebo explicitně označený odhad. Cursor obsahuje stabilní pořadí, např. timestamp + ID, a je svázaný s filtrem. Ledger používá workspace + seq. Žádné filtrování celé historie jen v aktuální stránce.

Structured event: `id`, `sessionId`, `runId`, `seq`, `at`, `type`, `payload`, `schemaVersion`. Typy zahrnují message.started/delta/completed, tool.started/result, approval.required/resolved, document.changed, usage.reported, run.status/error. Původní textové events převést jako legacy event; nedopočítávat z nich vymyšlenou historii.

Token streaming a streaming událostí jsou dvě různé vrstvy. Provider musí umět číst stream a bezpečně skládat tool-call fragmenty; nástroj se smí spustit teprve po úplném validovaném volání. Workflow přetrvá odpojení browseru. SSE pouze sleduje běh; reconnect nikdy znovu nespustí generaci. Ukládat delty po blocích, ne databázový zápis pro každý token. Konečná zpráva je autoritativní a opraví neúplné delty po reconnectu.

SSE má event ID, heartbeat a obnovu podle posledního potvrzeného seq. Při nedostupnosti použít delta polling: aktivní běh 1–2 s, idle 15–30 s, skrytá karta bez zbytečného obnovování; po návratu okamžitě synchronizovat. Autorizace stejná jako běžné API. Při chybě zobrazit stale timestamp.

## 12. Persistence, limity a cloud

Neon a Workflow již existují; není důvod provisionovat novou databázi nebo paralelní orchestrátor. Pro rozšíření jejich použití při implementaci načíst příslušné aktuální skilly.

Zavést append-only session events mimo ořezávaný JSON dokument, metadata sessions vhodná pro indexované dotazy a strukturované metriky běhů. Read models jsou obnovitelné projekce, ledger zůstává autoritativní pro auditní akce. Existující šifrované provider profily ponechat. Migrace je aditivní a idempotentní, následně backfill zachovaných dat; historicky ořezané events nelze obnovit a UI to přizná.

Pro 100+ sessions a dlouhý ledger zabránit načítání všech dokumentů a kompletní verifikaci při každém UI pollu. Ověřování má explicitní job/progress a rozsah. Případná cache výsledku musí být vázaná na ověřený head digest a klíč; nesmí označit nové nezkontrolované entries jako verified. Změřené pomalé dotazy řešit indexem a stránkováním, ne anonymním cachováním chráněných odpovědí.

Současný jeden aktivní cloudový běh zachovat do vyřešení kapacity. UI ukáže běžící session a umožní připravit draft další. Skutečná fronta vyžaduje trvalý queued stav, pořadí, storno a obnovu po restartu; nezobrazovat „ve frontě“ jen jako toast. Souběh více agentů není podmínkou kvalitního GUI, ale kapacita musí být transparentní.

Vercel: Node/Fluid Compute a existující Nitro zůstávají. Ověřit streaming skrze aktuální Workflow/Nitro integraci na preview; lokální úspěch sám nestačí. Veškeré chráněné API `no-store`. Veřejné hashované assets mohou mít dlouhou immutable cache. Service worker případně cachuje jen shell; konverzace, dokumenty a klíče necachovat automaticky do offline storage.

Při přílohách respektovat současný Express limit 64 KB: pro upload navrhnout samostatný limitovaný tok. Nezvyšovat globálně JSON limit kvůli souborům. Velké binární soubory vyžadují skutečné privátní úložiště; vybrat až podle potřeby a existujících možností, s načtením marketplace skillu před novou integrací.

Vercel CLI podle session hlášení zaostává (`59.11.2` proti `59.16.0`). Před implementačním deploymentem doporučena aktualizace `npm i -g vercel@latest` nebo `pnpm add -g vercel@latest` a ověření aktuální verze. V tomto plánovacím kroku se globální CLI nemění.

## 13. Přístupnost, chyby a výkon

- Kompletní klávesnicový průchod: sidebar, model picker, zprávy, tabulky, dialogy. Escape zavře aktuální overlay, focus se vrátí na vyvolávající ovladač.
- `Cmd/Ctrl+K` hledání, samostatná akce nového chatu; zkratky se nespouštějí během psaní ani IME. Volitelné a dohledatelné v nápovědě.
- Screen reader dostává krátký stav běhu, ne live oznámení každého tokenu a celé tabulky při refreshi.
- Connection gate: přihlášení, kontrola workspace, kontrola providera, připraveno. Chyba 401 není prázdná historie; 403 oprávnění; 404 zaniklý objekt; 409 konflikt; 429 omezení; 5xx opakovatelná chyba se zachovaným draftem.
- Onboarding bez tvrzení „protection active“, dokud klient nemá skutečný stav serveru.
- System/light/dark preference, správné `theme-color`, reduced motion a test zvětšení na 200 %.
- Měřitelné cíle: LCP do 2,5 s, INP do 200 ms, CLS do 0,1 za dokumentovaných podmínek. Jsou to cíle, nikoli současné výsledky.
- Výchozí JS rozpočet shellu do 250 KB gzip; editor/highlighter/graf lazy-loaded. Změnu rozpočtu zdůvodnit měřením.
- QA dataset alespoň 150 sessions, 1000 zpráv v testovací konverzaci a 10 000 ledger entries. Tabulka načítá stránku, ne celý dataset. Transcript má stabilní klíče; virtualizovat až po změření problému a s ohledem na hledání/kopírování.

## 14. Implementační etapy

Odhady jsou plánovací rozpětí soustředěné práce, nikoli závazný kalendář. Celkově přibližně 23–41 pracovních dnů pro jednoho vývojáře s agentní asistencí, podle streamingu, migrace a produkčních omezení. Testy jsou součástí každé etapy.

| Etapa | Rozsah a hlavní soubory | Závisí na | Důkaz dokončení | Odhad |
|---|---|---|---|---|
| E0 | Baseline, kontrakty, anonymizované QA datasety, desktop/mobile reference; tests + docs | Tento plán | Reprodukovatelné stavy a seznam stávajících API | 1–2 dny |
| E1 | TokenRouter preset, serverový default, migrace preference; provider/index/cloud | E0 | Čistý browser volí GLM, živý smoke na preview, stará session beze změny | 1–2 dny |
| E2 | Vite/React shell, router, login gate, tokens, sidebar/drawer; build/server/desktop | E0 | 320–1920 px, deep link refresh, stejný build v lokálu a preview | 3–4 dny |
| E3 | Chat Markdown, composer, draft, model picker, tool cards, session správa | E1+E2 | Chat a dokumentový write přes reálné API, focus/scroll/draft zachován | 3–5 dnů |
| E4 | Structured events, historie, stream adapter, SSE, reconnect, usage | E3 | Přerušit browser, obnovit bez duplicity; cancel a tool fragments správně | 3–6 dnů |
| E5 | Dokumenty, přílohy, editace s revizí, diff, Undo, větvení | E3+event kontrakt E4 | Změna, konflikt, preview, Undo a ledger navzájem souhlasí | 3–5 dnů |
| E6 | DataTable, serverové filtry, přehled, runs, ledger, approvals | E2+E4 | Najde se starý záznam mimo první stránku; agregace sedí s API | 3–5 dnů |
| E7 | Konektory, tool katalog, modely/usage, settings, uložené pohledy | E3+E6 | Skutečné capability, žádné smyšlené ceny, úplné loading/error stavy | 2–4 dny |
| E8 | Mobilní klávesnice, a11y, dlouhé historie, výkon, CSP a regresní opravy | Průběžně; finálně E1–E7 | Testovací matice níže projde, doložené screenshoty a měření | 3–5 dnů |
| E9 | Aditivní migrace, Vercel preview, produkční release, rollback smoke | E8 | Funkční produkční story včetně default modelu a Undo | 1–3 dny |

Každý checkpoint obsahuje demo URL nebo lokální příkaz, reálný dataset, screenshot desktop/mobile, výsledek testu a známé limity. Po dokončení E3 je použitelný nový chat; práce pokračuje E4–E9, aby splnila celé zadání.

## 15. Testovací scénáře a akceptační matice

| Scénář | Očekávaný výsledek |
|---|---|
| Nový workspace / prázdné browser storage | TokenRouter + GLM předvolen; bez klíče jasné připojení |
| Existující session s jiným providerem | Zachová původní provider/model a obsah |
| Odpojit a obnovit internet během odpovědi | Běh pokračuje serverově, UI obnoví chybějící seq bez duplicit |
| Stop během modelu / nástroje | Pravdivé stavy; žádná nová akce po účinném storno |
| Dvojklik Poslat / timeout a retry | Jediný tah díky idempotenci |
| Dva browsery rozhodnou stejné schválení | Jedno přijaté rozhodnutí; druhý vidí vyřešeno/konflikt |
| Expirace approval při otevřeném dialogu | Server odmítne pozdní rozhodnutí; UI se aktualizuje |
| Dokument změněn před potvrzením Undo | Nový preview nebo 409; žádné přepsání novějšího obsahu |
| Editace staré zprávy s tool operacemi | Nová větev, žádné implicitní znovuprovedení nástroje |
| Ledger filtr a proklik agregátu | Stejný scope, stabilní stránkování, odpovídající počty |
| Vyhledat 151. session / starší event | Server dohledá zachovanou historii mimo současné limity |
| Provider 401/403/404/429/timeout | Konkrétní chyba, draft zachován, bez placeného fallbacku |
| Markdown s HTML/JS payloadem | Žádné vykonání skriptu ani nebezpečného odkazu |
| Dlouhý název, JSON, kód a Markdown tabulka | Žádný overflow shellu; detail zůstává ovladatelný |
| Klávesnice a screen reader | Žádná focus past, správné labely a krátká live oznámení |
| Vercel cold start / reload deep linku | API i app route fungují; žádné 404 statických assetů |
| Lokální a zabalený desktop | Stejné GUI, správné lokální capabilities a download |

Viewporty: 320×568, 390×844, 430×932, 768×1024, 1024×768, 1280×720, 1440×900, 1920×1080. Chrome/Safari/Firefox/Edge podle podporované platformy; alespoň fyzický iOS Safari a Android Chrome pro klávesnici, safe area a návrat z backgroundu. Light/dark, 200% zoom, reduced motion. Nejde o nutnost všech kombinací v kartézském součinu; každá kritická vlastnost má zvolený reprezentativní test.

Základní příkazy zachovat: `pnpm run typecheck`, `pnpm test`, relevantní `pnpm desktop:test`. Přidat frontend build a browser E2E script teprve s konkrétní testovací sadou. Preview musí ověřit skutečný cloudový provider a storage; QA fixture ověřuje UI a nástrojový tok, nikoli dostupnost TokenRouteru.

## 16. Nasazení a návrat

Implementovat na izolované větvi `codex/gui-upgrade`, se zachováním stávajících necommitnutých souborů. První preview používá oddělená data od produkce. Migrace přidává nové sloupce/tabulky; před destruktivním krokem záloha a ověřená obnova. Starý i nový build musí po přechodné období rozumět stávajícím datům.

Před produkcí: úspěšný build, typecheck a relevantní testy; přihlášení, skutečná GLM generace, nástrojový write, approval flow, Undo a ledger na preview; screenshoty desktop/mobile. Produkční promotion až v rámci následně autorizované implementace a release. Tento tah připravuje plán, nikoli release.

Rollback: vrátit předchozí funkční deployment bez smazání nové historie a evidence. Pozastavit nové experimentální funkce, ne mazat ledger. Aditivní schema musí umožnit přečtení starým buildem; pokud ne, předem připravit kompatibilní release. Prověřit, zda běžící Workflow zůstávají kompatibilní s verzemi eventů.

## 17. Definice dokončení celého upgradu

- Nový uživatel otevře web, připojí workspace a pracuje s výchozím GLM 5.3 Free přes TokenRouter.
- Na telefonu může psát bez odscrollování celé stránky; historie, dokumenty a schvalování mají vlastní funkční plochy.
- Chat zobrazuje Markdown/kód/tabulky, skutečný průběh agenta a detail nástrojů, zachovává draft a scroll.
- Každá entita uvedená v přehledové matici má seznam, detail, dostupné akce a serverový zdroj dat.
- Dlouhá historie je dohledatelná; export neoznačuje ořezaný seznam za kompletní.
- Změny dokumentů mají revize, diff a ověřené Undo; evidence zůstává neměnná.
- Modely, spotřeba, limity a dostupnost odpovídají skutečným datům, se zdrojem a časem aktualizace.
- Projdou lokální, preview i produkční kritické toky, přístupnost a reprezentativní mobilní testy.
- Aktualizovaná dokumentace uvádí skutečně dodané funkce, omezení a postup dalšího vývoje.

Pro následnou realizaci začít E0 a E1, potvrdit aktuální stav repozitáře a aktualizovat evidenci při každé etapě. Jakoukoli změnu scope zapsat sem; nepřevést celý plán na krátký kosmetický redesign.
