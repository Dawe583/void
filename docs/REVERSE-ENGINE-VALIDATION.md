# VOID reverse engine: ověření jádra a skutečné hranice

Datum: 2026-09-11. Rozsah: ledger, policy, registry, proxy, connectors, CLI replay, SDK a managed document engine. Tento audit nehodnotí GUI ani TUI. Všechny změny a testy běžely s izolovanými dočasnými daty. Nebyla provedena produkční destruktivní operace ani deployment.

## Výsledek

**404 testů jádra prošlo, 0 selhání, 0 přeskočených testů.** Prošel také typecheck všech balíčků, pět scénářů `e2e-connectors` a osm scénářů `e2e-final`.

VOID dnes poskytuje integrované Undo pro vlastní spravované textové dokumenty a samostatné konektorové inverse pro omezené operace PostgreSQL a kompenzační obnovu S3. **Není to univerzální Ctrl+Z pro libovolný nástroj nebo vedlejší efekt agenta.** Klasifikace R1 ani schválení operace samy nevytvoří předchozí stav.

Nové testy odhalily a opravy odstranily ztrátu souběžných zápisů manifestu, nefunkční lokální namespace konektorového capture, důvěru v modifikovatelný inverse plán, provádění PostgreSQL inverse bez transakce, souběžné použití jedné transakční connection, vrácení nedostupného nadlimitního snapshotu a nedostatečné autentizování CLI replay.

## Co bylo spuštěno

```sh
node scripts/src/check-reverse-engine.mjs
pnpm -r --filter './packages/**' --if-present typecheck
node scripts/src/e2e-connectors.mjs
node scripts/src/e2e-final.mjs all
```

Runner spouští balíčky v jejich vlastním pracovním adresáři, protože fixture cesty SDK závisejí na package cwd. Nezahrnuje soubory GUI, adresář TUI ani provider test suites. Stávající workbench scénáře používají deterministické modelové odpovědi; nejde o ověření skutečného vzdáleného modelu.

| Balíček | Prošlo | Co pokrývá |
|---|---:|---|
| ledger | 49 | Řetěz, podpisy, změny obsahu/workspace, attestation, pořadí a integrita |
| policy | 75 | Allow/hold/deny, expirace, souběžná rozhodnutí, persistence, fail-closed |
| registry | 38 | Klasifikace, facts, neznámé operace, podmínky reversibility |
| proxy | 80 | Forward, deny, approval, chyby dependency, HTTP/stdio, transport a bezpečnost |
| connectors | 67 | SQL capture/inverse, cascade, S3, snapshoty, drift, race, rollback a tampering |
| cli | 69 | Replay, key verification, manifest binding, chyby adapterů a další core příkazy |
| sdk | 9 | Skutečný proxy subprocess, forward a schvalování |
| workbench | 17 | Managed dokumenty, inverse, signed evidence, restart, konflikty a storage |

PGlite spouští skutečný PostgreSQL engine v procesu. Testuje SQL, constrainty, transakční rollback a cascade obnovu; není důkazem chování vzdáleného PostgreSQL clusteru při síťovém výpadku. S3 používá explicitní fake klienty s modelovanými ETag a podmíněnými zápisy. Nebyl proveden reálný restore do AWS účtu.

## Reálné cesty provedení

### Proxy a SDK

`tools/call` projde klasifikací a policy. Rozhodnutí a jeho vyřešení se zapíší do ledgeru před forwardem. Chyba zápisu ledgeru v testovaném interceptoru vrací deny. Hold čeká na rozhodnutí nebo expiraci. Proxy/SDK pak zprostředkuje externí volání.

**Proxy nyní automaticky nevolá PostgreSQL/S3 `connector.capture()`.** Vazba capture a skutečného externího zápisu je odpovědností integrujícího hostitele. Podepsané `allow:resolved` znamená oprávnění pokračovat, nikoli důkaz úspěšného externího zápisu nebo existence inverse. Konektorová API a E2E harness tuto kompozici umějí sestavit, ale nejde o obecnou schopnost každého MCP serveru.

### Managed textové dokumenty

Workbench používá vlastní omezený namespace dokumentů. Write/delete uchovají before/after a ID operace. Dokumenty, inverse a signed evidence se lokálně ukládají do jednoho atomického šifrovaného snapshotu. Undo ověřuje podpisovou vazbu capture a vyžaduje aktuální přípustný stav dokumentu. Novější změna, včetně ABA změny obsahu zpět, staré Undo zablokuje. Stejné operation ID nemůže označovat jiný požadavek. Opakování dokončeného Undo se nechová jako nový přepis.

Jde o spravované dokumenty, nikoli obecný filesystem počítače. Limity počtu souborů, velikosti a historie jsou záměrné; kapacita mutací rezervuje místo pro Undo.

### PostgreSQL konektor

Capture parsuje podporovaný SQL tvar, vybere předchozí řádky podle schématu a při delete prochází známé ON DELETE CASCADE vazby. Inverse obnoví zachycené řádky ve správném pořadí. Při update porovnává skutečný aktuální stav s očekávaným výsledkem původního podporovaného zápisu.

Apply nyní vyžaduje executor s `begin`, `commit`, `rollback`, zamyká existující kontrolované řádky pomocí `FOR UPDATE` a serializuje dvě inverse operace sdílející stejný executor. Běžný CLI adapter vlastní jednu connection a začíná SERIALIZABLE transakci. Jakákoli chyba uvnitř inverse vede k rollbacku; neurčitý výsledek COMMIT není prezentován jako úspěch a nesmí vyvolat slepý retry.

Capture a původní externí forward nejsou automaticky jedna transakce. Mezi nimi může nastat změna. Triggery, funkce se side effects, computed hodnoty, další služby, sekvence a obecné DDL nejsou úplně pokryté inverse tohoto konektoru.

### S3 konektor

Capture ukládá bytes a persistovaný envelope cíle. Apply znovu načte digestově ověřené snapshoty. Drift kontroluje ETag; následný put používá `If-Match` nebo `If-None-Match: *`, takže modelovaný souběžný zápis dostane konflikt místo přepsání.

**Jde o kompenzaci vytvořením objektu/verze, nikoli obnovení původní historie.** Konektor nezaručuje obnovení ACL, tags, metadata, retention, všech verzí nebo externích consumers. ETag není obecný čítač revizí: stejný obsah může skrýt ABA historii. Opakovaný restore může vytvořit další verzi; nejde o obecné exactly-once Undo.

## Opravené chyby a důkazy

| Nález | Před opravou | Oprava a test |
|---|---|---|
| Lokální connector capture | Namespace `workspace/postgres` odmítal LocalSnapshotStore; memory fixture problém skryla | Namespace `postgres-workspace`; skutečný local store + PGlite capture/restart/restore |
| Souběžný manifest | Více writer instancí četlo tentýž stav a přepisovalo si záznamy | Sdílená serializace a exkluzivní procesový lock; 40 souběžných writerů zachová 40 záznamů |
| Durability manifestu | Rename bez explicitního fsync | Synchronizace souboru a adresáře před návratem |
| Modifikace plánu | Apply používal mutable private payload inverse | Reload snapshotu přes ověření digestu a kontrola veřejných kroků; test změny řádku i cíle |
| Ztráta call metadata po restartu | PostgreSQL snapshot ukládal jen image | Verzovaný envelope s call + image, kompatibilní čtení starých image |
| Neatomická SQL inverse | Query-only executor mohl provést částečný restore | Odmítnutí před první query bez transaction lifecycle; skutečný constraint failure obnovu celou rollbackuje |
| Souběžné Undo stejné connection | Dvě operace mohly proložit transaction lifecycle | Fronta na executor; test právě jednoho restore a jednoho drift refusal |
| Check/write mezera při restore | Kontrolované existující řádky nebyly explicitně zamčené | `FOR UPDATE` v kontrolním čtení, v CLI nad SERIALIZABLE transakcí |
| Nadlimitní snapshot | Retention mohla odstranit právě zapsaný nadlimitní snapshot a put vrátit jeho reference | Předběžné odmítnutí bez odstranění již existujícího inverse |
| CLI hash-only důvěra | Přehašovaný ledger či zaměněný manifest mohl řídit mutation | Apply vyžaduje ověřené podpisy, `execute:completed` a podepsaný `captureDigest`; testy rehash a substitution |
| Chyby služby | Některé inverse chyby mohly propagovat text driveru | Sanitizované odmítnutí; S3 permission failure nevolá write a nevrací credential |

Nové důkazy jsou v `packages/connectors/src/reverse-engine.test.ts`, `packages/cli/src/replay.test.ts` a `packages/connectors/src/s3/apply.test.ts`. Cross-layer scénář výslovně skládá hostitelský capture, skutečný intercept, podepsaný JSONL, SQL forward a konektorové Undo. Neimplikuje automatické capture uvnitř proxy.

## Změna CLI replay kontraktu

Inspect-only náhled staré historie zůstává dostupný:

```sh
void replay --ledger /path/workspace.jsonl --snapshot-dir /path/snapshots --seq 3 --dry-run
```

Skutečný apply navíc potřebuje důvěryhodný veřejný SPKI klíč přes `--key` nebo `VOID_VERIFY_KEY` (library může dodat `publicKey`), záznam `decision: execute:completed` a `captureDigest` přesně rovný `manifest.reference.digest`.

```sh
void replay --ledger /path/workspace.jsonl --snapshot-dir /path/snapshots --seq 3 --key "$VOID_VERIFY_KEY"
```

Konkrétní service adapter musí být nakonfigurovaný; samotný klíč žádné služby nepřipojuje. Historické authorization-only nebo nepodepsaně svázané capture záznamy se nesmějí dodatečně vydávat za důkaz dokončení. Zůstávají inspect-only. Náhled `--dry-run` sám o sobě nepotvrzuje oprávnění ani budoucí úspěch apply.

## Matice hranic

| Situace | Očekávané chování / ověření |
|---|---|
| Managed create/update/delete | Zachycení předchozího obsahu; podepsané Undo ověřeno |
| Managed newer edit / ABA | Odmítnutí starého Undo ověřeno |
| Managed ID collision / retry / restart | Idempotence a persistence ověřeny |
| SQL podporovaný UPDATE | Capture a obnova testovány na PGlite |
| SQL DELETE s cascade | Parent/child pořadí a nesouvisející řádky testovány |
| SQL human drift / chybějící řádek | Odmítnutí místo přepisu testováno |
| SQL částečné selhání | Reálný constraint rollback testován |
| SQL dvě Undo stejné connection | Jedno provedení, jedno odmítnutí testováno |
| SQL dvě síťové connection / výpadek COMMIT | Síťově zde netestováno; neznámý výsledek vyžaduje inspekci |
| Capture versus původní forward race | Hostitel musí řešit transakční hranici; obecně nezaručeno |
| S3 delete/restore bytes | Fake client round trip testován |
| S3 concurrent writer / 412 | Podmíněný zápis odmítne overwrite v testu |
| S3 credentials/permission failure | Bez mutace a úniku textu upstream chyby |
| S3 všechny metadata/verze/ABA | Úplná historie a metadata se neobnovují |
| Manifest race / binding / snapshot bytes tamper | Ztráta, substitution a poškození testovány a odmítnuty |
| Ledger append failure / rehash / signature | Fail-closed / podpisová kontrola testovány |
| Irreversible operace (odeslaný email, platba, cizí API) | Policy může řídit spuštění; obecný inverse neexistuje |
| Smazaný/retencí odstraněný snapshot | Undo není dostupné, bez snapshotu se nesmí předstírat obnova |
| Více závislých externích služeb | Žádná obecná distribuovaná transakce ani automatický rollback grafu |

## Zbylé praktické limity

- Obecný proxy ledger zaznamenává rozhodnutí; ne všechny externí výsledky mají samostatný podepsaný execution record. Nový CLI apply tento rozdíl respektuje.
- CLI connector replay samo automaticky nepřidává signed Undo receipt do původního ledgeru. Managed document engine takovou navazující evidenci má. Integrující hostitel externího replay musí evidenci dokončení zajistit.
- Snapshot retention úmyslně může odstranit starší inverse. Podepsaný ledger nezaručuje budoucí dostupnost snapshotu.
- Exkluzivní manifest lock po pádu může zůstat; jeho odstranění vyžaduje ověření, že writer neběží. Automatické hádání stáří locku není bezpečné.
- Lokální JSONL ledger není distribuovaný multi-process consensus store. Testy jedné instance neprokazují bezpečnost všech multi-host writer topologií.
- Podpis dokládá původ a neměnnost zaznamenaného tvrzení, nikoli pravdivost libovolného vzdáleného service výsledku.
- Testy jsou konkrétní široká regresní matice, nikoli důkaz správnosti ve všech možných situacích. Reálné PostgreSQL network fault injection, AWS restore se skutečnou versioning/retention konfigurací a další MCP služby v tomto běhu ověřeny nebyly.
