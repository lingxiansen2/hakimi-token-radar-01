# hakimi-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lingxiansen2/hakimi-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lingxiansen2/hakimi-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Empirically calibrated pre-token launch valuation radar and actionable farming terminal built with Node.js 22 (standard library only) and a zero-network offline dashboard.

## Architecture

- **Audited Pre-Token Filter (`lib/filter.ts`)**: Partitions the sealed DefiLlama snapshot (`758` protocols) into separated live-token peers (`416`), excluded CEX/bridge/staking/versioned/parent-brand wrappers (`157`), and `185` clean pre-token targets (`40` flagship watchlist + `145` early discovery).
- **Two-Split Held-Out Valuation Engine (`lib/valuation.ts`)**: Fits a Huber-IRLS Ridge log-valuation model (`log10(mcap_usd)`) on `88` DeFi tokenized reference protocols and runs forward feature ablation across both Split A (5-fold stratified CV) and Split B (temporal out-of-time holdout). Keeps only features that improve both splits (`log10(TVL)`, empirical-Bayes sector multiple, and `log10(chain count)`), emitting P10–P90 residual prediction intervals, factor waterfalls, and nearest tokenized peer comparables.
- **Protocol-Aware Farming Playbooks (`lib/farming.ts`)**: Generates concrete, chain-gas- and cadence-quantified farming steps tailored to each protocol's category, chain footprint, TVL scale, and 7-day TVL velocity.
- **Offline Dashboard (`dashboard/`)**: Static zero-network terminal (`40.2 KB` total source) with log-scale scatter chart, sector multiples, live filtering/sorting, factor waterfall inspector, and full model ablation audit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
