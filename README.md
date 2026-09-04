# 🐀 uncle-watch

**Who is selling your stock at the top — and how often they've done it before.**

A former NYSE Vice Chairman joined a quantum-computing company's board in 2021.
In September 2025 he sold 15%, then 41%, then 60%, then 75% of his stake — in four consecutive days, inside a 12% price band, five days before the stock rolled over.

Every number in that sentence is from public SEC filings. Nobody reads them. This tool does.

> Not investment advice. Not an accusation — everything here is legal and disclosed.
> All data is public SEC filings. We just read them. *Someone should.*

## quick start

```
npx uncle-watch rate QUBT
```

or from source:

```
git clone https://github.com/PeachMo16/uncle-watch && cd uncle-watch
node uncle.mjs rate QUBT
```

No dependencies. No API keys. Node 18+ and the SEC's public EDGAR API.
A [weekly leaderboard](LEADERBOARD.md) of the tickers in [WATCHLIST](WATCHLIST) is
rebuilt by GitHub Actions every Monday — send a PR to add a ticker.

The parser, amendment handling, rolling-window clustering, and score dimensions are
covered by synthetic fixtures, so the tests never need the network:

```
npm test
```

## the four commands

### `uncle rate <TICKER>` — how uncle is this boat?

Downloads the most recent Form 4s (EDGAR's recent list, capped at 200; coverage is
printed rather than assumed), classifies each sell's plan status three ways —
**10b5-1 indicated / no 10b5-1 indication / unknown** (the SEC's mandatory checkbox
only applies to filings from April 2023; before that, a missing flag proves nothing) —
then scores six risk dimensions, each 0–100 with the evidence attached:

| dimension | what it smells for |
|---|---|
| No 10b5-1 indication | sells filed without the pre-scheduled-plan checkbox |
| Cluster density | different insiders reaching for the exit in the same week |
| Ladder acceleration | escalating %-of-stake sells day after day (whole run worth ≥ $25k — shape alone is not a signal) |
| Exit discipline | one insider unloading inside a tight price band |
| Dilution engine | shelf registrations and offering supplements |
| Shell history | name changes, fresh 10-12G registrations (reverse-merger tell) |

Open-market insider buying is reported as an independent **counter-signal** — shown
in green, never scored. Real buying is positive information when present, but the
literature gives no exchange rate against sell-side risk, and a token buy must not
launder a boat. Absence of buying is *not* evidence of danger.

Composite = weighted average = the **uncle rate**. It also derives the **uncle exit zone**:
the price band where insiders historically pulled the ripcord.

```
🐀 $QUBT · UNCLE RATE 83/100

  No 10b5-1 indication  87   20 of 23 status-known sells filed with no 10b5-1 indication
  Cluster density      100   4 strict 10-day windows with ≥2 insiders selling
  Ladder acceleration  100   one insider escalated 53% → 100% of stake (~$573k) in 3 days
  Exit discipline       74   5 sells inside $15.02–$16.88 (12% band)
  Dilution engine      100   27 offering/shelf filings
  Shell history         30   fresh 12(g) registration (a common reverse-merger route)

  · Open-market insider buying: none observed (not scored)

  uncle exit zone: $11.70–$15.62 (median $15.02) · last close $8.46
```

For calibration, the same rubric on a boring mega cap:

```
🐀 $GOOG · UNCLE RATE 17/100

  No 10b5-1 indication   0   0 of 306 status-known sells filed with no 10b5-1 indication
  Cluster density        0   no multi-insider sell clusters
  Ladder acceleration    0   no escalating multi-day sell ladders worth ≥ $25,000
  Exit discipline        0   no insider with ≥3 sells lacking a 10b5-1 indication
  Dilution engine      100   30 offering/shelf filings (mostly bond 424B2s — see limitations)
  Shell history          0   no name changes or fresh registrations on file

  · Open-market insider buying: none observed (not scored)
```

Three hundred and six insider sells at Alphabet. Every single one under an indicated
10b5-1 plan. That's what a boring boat looks like.

<p align="center">
  <img src="assets/radar-qubt.svg" width="46%" /> <img src="assets/radar-goog.svg" width="46%" />
</p>

### `uncle who <name|CIK>` — one uncle's entire career, and whether it just changed

Every reporting owner has a personal CIK. Feed it in and get every company
they've ever filed ownership forms on — their whole career of boats. `who` follows
the SEC's older submission-index files and downloads every supported ownership XML
by default, grouped by **issuer CIK** so ticker and name changes stay together and
two people with the same name stay apart. It covers what EDGAR still serves, not
every trade of a lifetime — and it prints what it couldn't get.

```
node uncle.mjs who 1215183
node uncle.mjs who 1215183 --as-of 2025-09-17 --recent-days 90
node uncle.mjs who 1215183 --limit 200 --json
```

The report compares the most recent 90 calendar days with the preceding 1,095
days **at each issuer separately**. It shows selling/buying days, sale months,
plan-status counts and, when the record supports it, the recent median reported
sale value per selling day divided by that person's baseline median. Multiple
transaction rows on one day are combined so splitting an order does not create
extra selling days. It does not pool prices or dollar baselines across companies.

The size ratio is withheld if the baseline has fewer than five selling days or
less than 180 days between its first and last sale, if price/security/ownership
basis is missing or mixed, if joint-owner filings obscure attribution, or if
known coverage gaps affect the comparison period. Those minimums are display
heuristics, not validated predictors. Values are reported units, without
currency, inflation or stock-split normalization. A ratio is a descriptive change,
not a probability of misconduct or a return signal. Calendar-month lists do not
implement the Cohen/Malloy/Pomorski routine/opportunistic classifier.

`--as-of` excludes later filings **before** resolving amendments, so a later
correction cannot rewrite an earlier report. Transaction dates after the cutoff
are excluded too. This is a day-level reconstruction from currently retrievable
filings, not an archived intraday market-data snapshot. The default cutoff is
today in UTC. The JSON includes raw transaction timelines, accession numbers,
filing dates, acceptance timestamps, source links, excluded records and coverage.

For the dated Fagenson example, the observed issuers are:

```
FAGENSON ROBERT B (CIK 1215183) · as of 2025-09-17
57/57 supported XML filings loaded; no download failures or limit omissions

  RWY    RENT WAY INC               2003 → 2006    6 filings
  DSS    DOCUMENT SECURITY SYSTEMS  2004 → 2018   26 filings
  TQ     CASH TECHNOLOGIES          2007           1 filing
  NHLD   NATIONAL HOLDINGS          2012 → 2021   15 filings
  QUBT   Quantum Computing Inc.     2021 → 2025    6 filings
```

Five boats, all micro caps, one career. The only boat he ever cashed out on
is the one that 40x'd during a hype wave. That list is a fingerprint.

The QUBT window contains five observed selling days and zero in its preceding
baseline window, so the personal size ratio is **unavailable**, not infinity.
The tool won't invent a prior routine to compare against — the list above is the
comparison, and it's the reader's job to read it.

Reports save to `data/people/<CIK>/history.json`; an explicit cutoff saves to
`history-YYYY-MM-DD.json`. Use `--data-dir <directory>` to isolate a run. Name
lookup searches cached insiders and refuses ambiguous matches; a CIK is direct.

### History coverage options

```
node uncle.mjs rate QUBT --history --limit all
node uncle.mjs actions QUBT --history --limit 500
```

`who` reads all advertised indexes and all supported XMLs unless `--limit N`
is supplied. `rate`/`actions` retain their recent-list, 200-XML default. `--history`
adds old indexes; `--limit all` removes the XML cap. The offering/shell dimensions
still use the recent index, preserving their existing definition. Changing the
ownership window can change the other dimensions; compare reports with the same
coverage, not just the same ticker.

Every fetch records loaded XMLs, unsupported non-XML filings, omitted filings,
failed downloads, failed/missing historical indexes and stale-cache use. Older
text-only documents remain unparsed. A failed history page never silently becomes
an empty history. Overlapping index pages are deduplicated by accession. Network
requests have timeouts and stay paced below SEC's published request limit.

### `uncle actions <TICKER>` — the raw feed

Every insider transaction, newest first — plan sells labeled, no-indication sells
flagged, pre-2023 sells marked `plan status ?` instead of pretending to know.

### `uncle tickets` — the leaderboard

Every ticker you've rated, sorted by uncle rate, with each boat's loudest dimension.

## honest limitations

- The classic insider-trading literature (Lakonishok & Lee 2001; Finnerty 1976) found
  pooled insider *sales* carry little predictive signal — the informativeness was in
  *purchases* — and mimicking profits in small/OTC stocks were eaten by trading costs
  (Rozeff & Zaman 1988; Lin & Howe 1990). uncle-watch's sell-based dimensions are not
  independently validated as return predictors. The uncle rate is a reading aid that
  ranks which filings deserve your attention; it is not, and must never be read as, a
  tradeable signal.
- The 10b5-1 checkbox is only mandatory on filings from April 2023, so plan status is
  three-valued; pre-2023 sells are `unknown` and excluded from *every* scored dimension
  rather than counted as unscheduled — each dimension prints how many it left out. The
  unscored exit zone still includes them and prints its basis. A micro cap whose whole
  story is pre-2023 will therefore score low on clusters, ladders, and discipline: that
  is the tool refusing to guess, not a clean bill of health. Read `uncle actions`.
- "No 10b5-1 indication" means exactly that — the filing didn't claim the affirmative
  defense. It is not Cohen/Malloy/Pomorski's behavioral routine/opportunistic
  classification (theirs is built from multi-year calendar regularity), and their
  results don't validate this filter.
- Foreign-issuer coverage varies by period and applicable exemption. From
  March 18, 2026, directors/officers of covered FPIs became subject to Section
  16(a) reporting, with SEC exemptions for qualifying cases. A 20-F/40-F/6-K
  flag is only a coverage prompt, not a determination of an individual's legal
  obligation. Earlier histories may still be absent from EDGAR; local-regime
  reporting such as SEDI is not yet integrated. See the current
  [SEC reporting overview](https://www.sec.gov/about/divisions-offices/division-corporation-finance/holding-foreign-insiders-accountable-act-section-16a-reporting-requirements).
- A Form 4/A supersedes only the original it names (via `dateOfOriginalSubmission`), so a
  sibling Form 4 for the same period survives; an amendment that names no original date
  falls back to superseding its whole (issuer, owners, period) group. Multi-owner joint
  filings are still attributed to each owner (slight double-count).
- The dilution dimension counts all offering paperwork — a mega cap's bond 424B2s score the same as a shell's equity ATM. Read the evidence line, not just the number.
- Submissions and prices are cached for 24h. Ownership XMLs are retained and
  reused locally; amendments have separate accessions. A local cache is not proof
  of what was publicly available at every historical instant.
- `who` analyzes non-derivative transactions; derivative tables and standalone
  holdings are not converted into sales. Issuer history can include a holdings
  filing without a purchase/sale event. Known omissions are not proof of absence.
- Price-context ratios for sales before the available daily-price feed are now
  unavailable; the tool never substitutes a later quote for an earlier sale.
- The weights and the $25k ladder floor are hand-tuned on a handful of anchors, not backtested. This is a reading tool, not a trading system.

## scoring changelog

**v0.4 (local development)** — historical submission indexes, explicit coverage,
CIK-based person/issuer continuity, and an independent personal-history report.
As-of filtering precedes amendment handling; 3/A and 5/A cannot erase a Form 4.
Unsupported/missing files remain visible, and historical price context never
borrows a future quote. FPI coverage wording updated for the 2026 rule change.
The six scoring formulas and weights remain scoring version 3; personal behavior
comparisons do not enter the composite.

**v0.3 (2026-09-01)** — three fixes from a second code read, each with a test:

- Form 4/A dedupe dropped innocent siblings: within one (issuer, owners, period) group,
  any amendment used to erase *every* original — a grant filed a week before a corrected
  sale went missing. Amendments now replace only the original whose filing date they
  name; an undated amendment keeps the old conservative behaviour.
- v0.2's "refuse to guess" about pre-2023 plan status only reached the ratio dimension;
  cluster density, ladder acceleration, and exit discipline still treated every
  unknown-status sell as unscheduled. All six scored dimensions now use only sells that
  affirmatively lack a 10b5-1 indication, and print the excluded count. The exit zone
  (unscored) keeps them, labeled.
- Ladder acceleration had no value floor: a 50% → 100% exit of a hundred-dollar stake
  scored 100, same as a seven-figure one. A run must now be worth ≥ $25k to count.

On the two README anchors nothing moved (QUBT 83, GOOG 17); the fixes bite on
tickers with pre-2023 histories, corrected filings, or token-sized insiders.

Also in v0.3: the SEC User-Agent lost its parenthesised URL — sec.gov started
answering 403 to it, which broke every fresh clone — and a failed EDGAR/Yahoo
fetch now falls back to a stale local cache with a loud warning instead of crashing.

**v0.2 (2026-08-30)** — scoring semantics audited against the 1974–2003 insider-trading
literature by [gold-digger](https://github.com/PeachMo16/gold-digger), a sibling project
that digs up old research and points it at live systems. The audit found a mislabeled
citation and two semantic overclaims; this release fixes them:

- Renamed "Opportunistic ratio" → "No 10b5-1 indication" and removed the CMP 2012
  citation from the filter: their routine/opportunistic split is behavioral (calendar
  regularity across years), not plan-checkbox status, and never validated this filter.
- Plan status became three-valued around the April 2023 checkbox rule; pre-2023
  "opportunistic counts skew high" is fixed by refusing to guess.
- Removed "Net insider flow" from the composite (an all-sell/zero-buy mega cap scored
  100 on it — absence of buying is not evidence of danger). Open-market buying is now
  an unscored counter-signal. Remaining six weights renormalized.

Deferred until the full texts are read: a Kahle (2000)–style event feature (abnormal
insider selling *before* an equity/convertible issue) and a real behavioral
routine/opportunistic classifier worthy of the CMP name.

## vibecoded

This project was built conversationally with an AI agent (Claude) from one person's
observation that the same names kept selling the same stock at the same heights.
Zero dependencies, plain Node, every score traceable to a filing. Fork it, point it at your ticker.

## license

MIT

## data documentation

- [SEC submissions API and older index files](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC developer access and request limits](https://www.sec.gov/about/developer-resources)
- [SEC 2026 foreign-insider reporting overview and exemptions](https://www.sec.gov/about/divisions-offices/division-corporation-finance/holding-foreign-insiders-accountable-act-section-16a-reporting-requirements)
