# 🐀 uncle-watch

**Who is selling your stock at the top — and how often they've done it before.**

A former NYSE Vice Chairman joined a quantum-computing company's board in 2021.
In September 2025 he sold 15%, then 41%, then 60%, then 75% of his stake — in four consecutive days, inside a 12% price band, five days before the stock rolled over.

Every number in that sentence is from public SEC filings. Nobody reads them. This tool does.

> Not investment advice. Not an accusation — everything here is legal and disclosed.
> All data is public SEC filings. We just read them. *Someone should.*

## quick start

```
git clone https://github.com/PeachMo16/uncle-watch && cd uncle-watch
node uncle.mjs rate QUBT
```

No dependencies. No API keys. Node 18+ and the SEC's public EDGAR API.

The parser, amendment handling, rolling-window clustering, and score dimensions are
covered by synthetic fixtures, so the tests never need the network:

```
npm test
```

## the four commands

### `uncle rate <TICKER>` — how uncle is this boat?

Downloads the most recent Form 4s (EDGAR's recent list, capped at 200 — the complete
history for most small caps), classifies each sell's plan status three ways —
**10b5-1 indicated / no 10b5-1 indication / unknown** (the SEC's mandatory checkbox
only applies to filings from April 2023; before that, a missing flag proves nothing) —
then scores six risk dimensions, each 0–100 with the evidence attached:

| dimension | what it smells for |
|---|---|
| No 10b5-1 indication | sells filed without the pre-scheduled-plan checkbox |
| Cluster density | different insiders reaching for the exit in the same week |
| Ladder acceleration | escalating %-of-stake sells day after day |
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
  Ladder acceleration  100   one insider escalated 53% → 100% of stake in 3 days
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
  Ladder acceleration    0   no accelerating multi-day sell ladders
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

### `uncle who <name|CIK>` — one uncle's entire career

Every reporting owner has a personal CIK. Feed it in and get every company
they've ever filed ownership forms on — their whole career of boats:

```
🐀 UNCLE WHO · FAGENSON ROBERT B (CIK 1215183) · 7 boats

  RWY    RENT WAY INC               2003 → 2006    6 filings
  DSS    DOCUMENT SECURITY SYSTEMS  2004 → 2018   27 filings
  TQ     CASH TECHNOLOGIES          2007           1 filing
  NHLD   NATIONAL HOLDINGS          2012 → 2021   16 filings
  QUBT   Quantum Computing Inc.     2021 → 2026    7 filings   sells: 5 tx ~$1,556,005
```

Five boats, all micro caps, one career. The only boat he ever cashed out on
is the one that 40x'd during a hype wave. That list is a fingerprint.

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
  three-valued; pre-2023 sells are `unknown` and excluded from the ratio rather than
  counted as unscheduled.
- "No 10b5-1 indication" means exactly that — the filing didn't claim the affirmative
  defense. It is not Cohen/Malloy/Pomorski's behavioral routine/opportunistic
  classification (theirs is built from multi-year calendar regularity), and their
  results don't validate this filter.
- Foreign private issuers (Canadian shells on NASDAQ) are exempt from Form 4 entirely — their uncles are behind the curtain. A SEDI adapter would fix this.
- Form 4/A amendments supersede their originals (deduped), but multi-owner joint filings are still attributed to each owner (slight double-count).
- The dilution dimension counts all offering paperwork — a mega cap's bond 424B2s score the same as a shell's equity ATM. Read the evidence line, not just the number.
- Submissions and prices are cached for 24h; Form 4 XMLs are immutable and cached forever.
- The weights are hand-tuned on a handful of anchors, not backtested. This is a reading tool, not a trading system.

## scoring changelog

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
