# Audit GUI před velkým upgradem

Datum: 2026-09-11. Lokální commit: `e301162`. Rozsah: všechny čtyři webové stránky, jejich společné CSS a klientské moduly, napojení lokálního i cloudového API, provider, session storage, dokumenty, schvalování, ledger a balení stejného webu do desktopové aplikace.

## Co bylo skutečně ověřeno

- Pročteny `apps/control-plane/web/index.html`, `feed.html`, `approvals.html`, `ledger.html`, `workbench.css`, `app.js`, `sessions.js`, `workspace-ui.js`, `cloud-settings.js`, `theme.js` a relevantní testy.
- Projit tok přes `apps/control-plane/api/server.ts`, `packages/workbench/src/{index,provider,workspace,storage}.ts` a `cloud/{server,provider,store,steps,workflow}.mjs`; inventarizovány endpointy a storage limity.
- Prohlédnuty `vercel.json`, `nitro.config.ts`, `scripts/src/build-web.mjs`, `apps/desktop/runtime.mjs`, `apps/desktop/scripts/prepare.mjs` a desktopová vstupní stránka.
- Použit existující graphify graf. Je z 6. září a nepopisuje spolehlivě nejnovější webový workbench. Sloužil k orientaci; níže uvedené nálezy vycházejí z aktuálního kódu a prohlížeče.
- V prohlížeči spuštěn izolovaný `scripts/src/preview-workspace.mjs`. QA model byl výslovně označený fixture, nikoli TokenRouter.
- Na desktopu 1440 × 900 ověřeno odeslání zprávy, dokončená odpověď a reálné vytvoření `plan.md` přes VOID document tool.
- Na mobilním viewportu 390 × 844 ověřen chat, dokumenty, náhled Undo, Feed a prázdná stránka Approvals. Ledger ověřen také na desktopu.
- Zobrazená změna měla podepsaný ledger; UI hlásilo `chain ok, signatures checked: 1 records checked`.
- Produkční vstupní stránka `https://void-tui.vercel.app` je dostupná a požaduje workspace token. Produkční přihlášené toky nebyly v tomto auditu ověřeny.
- Vercel MCP: projekt `void-tui`, Node `24.x`, framework `null`; poslední produkční deployment `dpl_BBh53V4VMvZvMKAJbz7BCxkScseV` měl `readyState: READY`. To samo nepotvrzuje funkčnost autentizovaných API.
- Lokální OpenCode konfigurace obsahuje TokenRouter, endpoint `https://api.tokenrouter.com/v1` a model `z-ai/glm-5.3-free` s názvem `GLM 5.3 Free`. Dostupnost generování u providera se v tomto auditu netestovala. Tajné klíče nebyly vypsány ani přeneseny do cloudu.

## Nálezy a jejich důsledky

| ID | Priorita | Důkaz | Dopad a požadovaná náprava |
|---|---|---|---|
| A01 | P0 | `workbench.css:222–236`; mobilní DOM měření níže | Historie a dokumenty se skládají nad/pod chat. Composer je mimo první obrazovku. Mobil potřebuje samostatný shell a přepínané plochy. |
| A02 | P1 | `sessions.js:58–63` | Každý event je odstavec s `textContent`. Chybí Markdown, tabulky, kódové bloky, přílohy a bohaté tool cards. |
| A03 | P1 | `provider.ts:32`, `sessions.js:130` | `stream: false` a polling 2 s. Tokenový streaming vyžaduje změnu provideru i serverového event protokolu. |
| A04 | P1 | `sessions.js:6–10,25–33`; `cloud/provider.mjs:8–14`; `cloud/server.mjs:307` | TokenRouter nemá preset. Model se vybírá z DOM/localStorage; cloud bez uloženého profilu používá Gateway. Nestačí přejmenovat option v selectu. |
| A05 | P1 | `app.js:29–33,110–123`; `cloud/server.mjs:415–422` | Tabulky mají pevné sloupce a klientské filtry nad posledními 50 záznamy. Přehled celé historie potřebuje serverové stránkování a filtry. |
| A06 | P1 | `cloud/store.mjs:50–55,131–138` | Seznam sessions má limit 100; events se ořezávají na 200. Úplné vyhledávání a export celé historie nyní nelze slibovat. |
| A07 | P1 | `cloud/server.mjs:313–317,335–342` | Cloud dovoluje jeden běžící agent. UI musí ukazovat kapacitu a stav čekání; paralelní běhy nejsou hotová schopnost. |
| A08 | P1 | `app.js:205–216`; `sessions.js:74–96`; `workspace-ui.js:18–23,46` | Nezávislé obnovování feedu, verifikace, sessions a dokumentů. Dokumenty se načítají i zavřené; celé seznamy se znovu renderují. Potřebný společný plán obnov a revize dat. |
| A09 | P1 | `cloud/store.mjs:116–128`; `cloud/server.mjs:415–435` | Čtení feedu i ověření čtou a ověřují celý ledger. Náklad roste s historií; nestačí pouze zrychlit vykreslení tabulky. |
| A10 | P1 | `workspace-ui.js:23` | Cache dokumentového panelu používá počet operací. Pro dlouhodobý model s retencí/stejným počtem položek je vhodná explicitní revize. Jde o konstrukční riziko, nikoli reprodukovanou ztrátu dat. |
| A11 | P1 | `app.js:46–56` | Schvalování nepředává do UI vysvětlení politiky; blast radius může být „not measured“. Doplnit strukturované důvody a jasné rozlišení deklarovaných/měřených dat. |
| A12 | P1 | `index.html` versus `feed.html`, `ledger.html`, `approvals.html` | Navigace a shell jsou opakované, názvy Activity/Feed a Home/Workspace se liší. Sjednotit rámec a slovník. |
| A13 | P1 | Desktopový a mobilní screenshot Feed/Ledger | Velké titulky, formulář workspace a opakované statusy odsouvají data dolů. Na desktopu ledger začínal kolem y=732. Datová plocha potřebuje kompaktní header. |
| A14 | P2 | `workbench.css:30` | Vlastní focus pravidlo neobsahuje `textarea`. Ověřit browser fallback a zavést konzistentní focus pro všechny ovladače. |
| A15 | P1 | `sessions.js:13–16,74–80,124–132` | Aktivní session není stabilně adresovaná URL; nové konverzace nemají zachovaný draft a nový výběr nevykreslí původní welcome. Doplnit router, draft a explicitní stavy. |
| A16 | P1 | `cloud/store.mjs:140–150`; `cloud/steps.mjs:184–188` | Spotřeba je textový event, ne strukturovaná metrika. Ceny, latence, context usage a historie modelů potřebují sběr dat. |
| A17 | P1 | `apps/desktop/scripts/prepare.mjs`; `server.ts:71,490` | Desktop kopíruje současné webové soubory; lokální server má omezené public asset cesty. Nový bundler musí řešit oba distribuční kanály. |
| A18 | P1 | Produkční screenshot před přihlášením | Connect panel se přidává nad celý workbench a ubírá výšku. Vyhradit samostatnou přihlašovací plochu a nespouštět chráněná načítání před připojením. |

## Přesné mobilní měření

Stav: dokončená QA konverzace s jedním dokumentem; dokumentový panel otevřený; výchozí scroll stránky.

| Prvek | Pozice Y | Výška |
|---|---:|---:|
| Historie / sidebar | 61 px | 241 px |
| Transcript | 398,5 px | 430 px |
| Composer (`#session-form`) | 848,5 px | 280,09 px |
| Dokumenty | 1285,33 px | 557,42 px |
| Spodní navigace | 779 px | 65 px |

Viewport byl 390 × 844 px. Dokument měl výšku 2067 px a šířku 390 px. V tomto stavu nebyl horizontální overflow stránky; problém je vertikální kompozice a dostupnost vstupu. Virtuální klávesnice skutečného telefonu nebyla emulována.

## Zachovat fungující vlastnosti

- Skutečné dokumentové operace, zachycené inverse a explicitní náhled Undo.
- Podepsaný append-only ledger a rozdíl mezi ověřením hash integrity a podpisů.
- Fail-closed pravidla, odmítnutí neznámých nástrojů a kontrolu expirovaných schválení.
- Escape nedůvěryhodného obsahu, HTTP-only cloud cookie, serverovou ochranu klíčů a veřejné HTTPS endpointy pro cloudové konektory.
- Nativní dialogy, minimální velikost běžných tlačítek 44 px, reduced motion, existující light/dark režim a safe-area padding.
- Rozdíl mezi managed dokumenty a soubory lokálního počítače.

## Provedené automatické kontroly

```sh
node --test apps/control-plane/web/app.test.mjs apps/control-plane/web/control-plane-pages.test.mjs packages/workbench/src/provider-native.test.ts packages/workbench/src/default-agent.test.ts
```

Výsledek: **23 passed, 0 failed**. Obsahují API/rendering, schvalovací stavy, escaping, podpisové indikátory, dokumentovou obnovu a Anthropic adaptér. Nejde o úplnou regresní sadu ani důkaz hotového budoucího GUI.

## Skilly

Nainstalovány oficiálním helperem `skill-installer`:

- `JuliusBrussee/caveman`, cesta `skills/caveman`, lokálně `~/.codex/skills/caveman`.
- `DietrichGebert/ponytail`, cesta `skills/ponytail`, lokálně `~/.codex/skills/ponytail`.

Oba `SKILL.md` byly přečteny. Použita stručná komunikace, zachování úplného vyžádaného plánu a opětovné využití backendu. Automatické načtení nově instalovaných skillů bude dostupné od příštího tahu. Projektové použití je zapsáno v `AGENTS.local.md`. Nebyly instalovány jejich doprovodné proxy, MCP servery ani systémové hooky, které uživatel pro tuto práci nepotřebuje.

## Hranice důkazů

Živé generování TokenRouteru, chování na fyzickém iPhonu/Androidu, dlouhá historie a autentizovaný produkční workflow zůstávají ověřovacími kroky implementace. Referenční claude.ai a OpenCode jsou funkční inspirace zadání; audit netvrdí úplnou shodu s jejich aktuálními placenými funkcemi. Produkce ani aplikace nebyly tímto plánováním přestavěny či nasazeny.
