export interface RawProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: RawProtocol[];
  watchlist: string[];
}

export interface FilterAudit {
  total_protocols: number;
  excluded_live_token: number;
  excluded_category: number;
  excluded_versioned: number;
  excluded_wrapper_word: number;
  excluded_cex_prefix: number;
  excluded_parent_brand: number;
  retained_total: number;
  retained_watchlist: number;
  retained_early_discovery: number;
}

export interface FilterResult {
  candidates: RawProtocol[];
  tokenized: RawProtocol[];
  watchlistSet: Set<string>;
  audit: FilterAudit;
}

export const EXCLUDED_WRAPPER_AND_CEX_CATEGORIES = new Set<string>([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Staking Pool',
  'CEX',
  'Anchor BTC',
  'Decentralized BTC',
  'Stablecoin Wrapper',
]);

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORDS = /\b(wrapped|staked|staking|restaked|bridged)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Partition the snapshot into:
 * 1) `tokenized`: protocols with a live recorded token (`gecko_id` or `symbol`), kept strictly separate as valuation peers.
 * 2) `candidates`: genuine pre-token targets (every watchlist protocol + audited non-wrapper early protocols).
 */
export function partitionProtocols(snapshot: Snapshot): FilterResult {
  const watchlistSet = new Set(snapshot.watchlist);
  const tokenized: RawProtocol[] = [];
  const tokenizedFirstWords = new Set<string>();

  for (const p of snapshot.protocols) {
    if (p.gecko_id !== null || p.symbol !== null) {
      tokenized.push(p);
      const firstWord = p.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (firstWord.length >= 4) tokenizedFirstWords.add(firstWord);
    }
  }

  const audit: FilterAudit = {
    total_protocols: snapshot.protocols.length,
    excluded_live_token: tokenized.length,
    excluded_category: 0,
    excluded_versioned: 0,
    excluded_wrapper_word: 0,
    excluded_cex_prefix: 0,
    excluded_parent_brand: 0,
    retained_total: 0,
    retained_watchlist: 0,
    retained_early_discovery: 0,
  };

  const candidates: RawProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (p.gecko_id !== null || p.symbol !== null) continue;

    if (watchlistSet.has(p.slug)) {
      candidates.push(p);
      audit.retained_watchlist++;
      continue;
    }

    if (p.category !== null && EXCLUDED_WRAPPER_AND_CEX_CATEGORIES.has(p.category)) {
      audit.excluded_category++;
      continue;
    }
    if (VERSION_SUFFIX.test(p.name)) {
      audit.excluded_versioned++;
      continue;
    }
    if (WRAPPER_WORDS.test(p.name)) {
      audit.excluded_wrapper_word++;
      continue;
    }
    if (EXCHANGE_PREFIX.test(p.name)) {
      audit.excluded_cex_prefix++;
      continue;
    }
    const leadWord = p.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (leadWord.length >= 4 && tokenizedFirstWords.has(leadWord)) {
      audit.excluded_parent_brand++;
      continue;
    }

    candidates.push(p);
    audit.retained_early_discovery++;
  }

  audit.retained_total = candidates.length;
  return { candidates, tokenized, watchlistSet, audit };
}
