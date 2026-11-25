import type { RawProtocol } from './filter.ts';
import type { ValuationPrediction } from './valuation.ts';

export interface FarmPlan {
  strategy_summary: string;
  est_gas_cost: string;
  time_commitment: string;
  risk_note: string;
  steps: string[];
}

function formatUsdShort(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(usd / 1_000)}K`;
}

function gasProfile(chains: string[]): { primary: string; gasTx: string; bridgeNote: string } {
  const lowCost = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Hyperliquid', 'Hyperliquid L1', 'Polygon', 'BNB', 'BSC', 'Avalanche', 'Aptos', 'Berachain', 'Monad', 'MegaETH', 'Ink', 'Abstract', 'Unichain', 'Sonic', 'Linea', 'Scroll', 'zkSync Era', 'Starknet'];
  const primary = chains[0] ?? 'Ethereum';
  if (primary === 'Ethereum' && chains.length === 1) {
    return {
      primary,
      gasTx: '$4-$16 per Ethereum L1 tx (batch during <12 gwei weekends)',
      bridgeNote: 'Use native Ethereum wallet; avoid tiny <$1k positions that gas erodes',
    };
  }
  const cheap = chains.find((c) => lowCost.includes(c)) ?? primary;
  if (cheap === 'Solana' || cheap === 'Sui' || cheap === 'Aptos') {
    return {
      primary: cheap,
      gasTx: '$0.01-$0.08 per tx',
      bridgeNote: `Deploy on ${cheap} to compound weekly actions at sub-cent transaction cost`,
    };
  }
  if (primary === 'Bitcoin' || primary === 'Lightning') {
    return {
      primary,
      gasTx: '$1-$6 per UTXO/channel open',
      bridgeNote: `Verify channel/custody rules on ${primary} before locking BTC liquidity`,
    };
  }
  return {
    primary: cheap,
    gasTx: '$0.03-$0.35 per L2/alt-L1 tx',
    bridgeNote: chains.length > 1 ? `Route via ${cheap} instead of Ethereum L1 to cut fees >90%` : `Transact directly on ${cheap}`,
  };
}

/**
 * Generate concrete, cost- and duration-quantified farming steps tailored to each
 * protocol's DefiLlama category, chain footprint, TVL scale, and 7d capital velocity.
 */
export function buildFarmPlan(p: RawProtocol, val: ValuationPrediction): FarmPlan {
  const cat = p.category ?? 'DeFi';
  const { primary, gasTx, bridgeNote } = gasProfile(p.chains);
  const tvlStr = formatUsdShort(p.tvl_usd);
  const fdvStr = formatUsdShort(val.implied_value_usd);
  const seasonNote =
    val.months_live !== null && val.months_live >= 12
      ? `mature ${val.months_live}m track record (elevated snapshot urgency)`
      : val.months_live !== null
        ? `${val.months_live}m since DefiLlama listing`
        : 'early discovery window';
  const momentumNote =
    p.change_7d !== null && p.change_7d > 5
      ? `TVL up +${p.change_7d.toFixed(1)}% in 7d — active inflow competition`
      : p.change_7d !== null && p.change_7d < -5
        ? `TVL down ${p.change_7d.toFixed(1)}% in 7d — lower points dilution per dollar`
        : 'steady 7d TVL base';

  let strategy_summary = 'Active Liquidity & Points Allocation';
  let time_commitment = '20 min setup + 10 min/wk';
  let risk_note = 'Smart contract & snapshot timing risk; monitor official governance channels.';
  let steps: string[] = [];

  if (['Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace'].includes(cat)) {
    strategy_summary = `${cat} Volume, OI & Maker Depth`;
    time_commitment = '15 min setup + 20 min/wk active volume';
    risk_note = 'Funding rate bleed and liquidation risk; hedge directional legs across venues.';
    steps = [
      `Bridge $500-$2,500 USDC to ${primary} (${bridgeNote}); budget ${gasTx} for margin deposits.`,
      `Build consistent weekly taker/maker volume and open interest on ${p.name} across 4-8 weeks rather than one-off wash spikes.`,
      `Keep resting limit orders or LP vault margin active over weekend snapshots to qualify for time-weighted liquidity multipliers.`,
      `Track fee-to-points efficiency (target <0.25% total slippage + fees over 30 days) given ${p.name}'s ${fdvStr} implied launch cap.`,
    ];
  } else if (['Dexs', 'Liquidity Manager'].includes(cat)) {
    strategy_summary = `Concentrated LP & Multi-Epoch Swap Activity`;
    time_commitment = '20 min setup + 10 min/wk rebalance';
    risk_note = 'Impermanent loss on volatile pairs; prefer correlated or stable-bluechip ranges.';
    steps = [
      `Seed a correlated or blue-chip LP range on ${p.name} (${primary}) with $1,000+ (${gasTx}); ${momentumNote}.`,
      `Execute organic spot swaps weekly over 6+ distinct days to satisfy unique-epoch and active-wallet filters.`,
      `Rebalance out-of-range positions every 7-14 days instead of churning daily, keeping cumulative fee cost under $15 on ${primary}.`,
      `Claim or compound LP fees inside ${p.name} rather than immediately withdrawing to preserve loyalty/duration weights (${seasonNote}).`,
    ];
  } else if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management'].includes(cat)) {
    strategy_summary = `Core Collateral Supply & Moderate Borrow Loop`;
    time_commitment = '15 min setup + 5 min/wk health check';
    risk_note = 'Keep health factor >= 1.6 to avoid liquidation penalties during volatility spikes.';
    steps = [
      `Supply $1,000-$5,000 of ETH, BTC, or stablecoins into ${p.name} on ${primary} (${gasTx}); current protocol TVL sits at ${tvlStr}.`,
      `Borrow 35%-50% LTV in a correlated stable asset if borrow multipliers apply, keeping health factor safely above 1.60.`,
      `Maintain the position uninterrupted for 30-90 days; ${p.name} has a ${seasonNote}, so duration-weighted points matter.`,
      `Check net borrow APY weekly so net carry stays near break-even (costing <1% annualized) relative to ${fdvStr} implied FDV.`,
    ];
  } else if (['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Basis Trading', 'Farm', 'Leveraged Farming', 'Indexes'].includes(cat)) {
    strategy_summary = `Curated Vault Allocation & Receipt Hold`;
    time_commitment = '10 min deposit + biweekly yield check (hold 45-90d)';
    risk_note = 'Curator strategy, underlying protocol, and vault withdrawal-queue risks apply.';
    steps = [
      `Deposit $1,000+ into ${p.name}'s flagship curated vault on ${primary} (${gasTx}) and hold the receipt token in your primary wallet.`,
      `Avoid short-term hopping: hold through at least 2 full monthly epochs (45-90 days) since ${cat} programs weight time-integrated TVL.`,
      `Verify whether ${p.name}'s receipt token stacks secondary points on partner money markets on ${primary} (${bridgeNote}).`,
      `Review vault utilization and net APY every 14 days; ${momentumNote} across ${p.chains.length} tracked chain${p.chains.length === 1 ? '' : 's'}.`,
    ];
  } else if (['RWA', 'Dual-Token Stablecoin'].includes(cat)) {
    strategy_summary = `Yield-Bearing Stable/RWA Mint & DeFi Composing`;
    time_commitment = '15 min mint/KYC check + passive 60-90d hold';
    risk_note = 'Issuer custody, redemption queue, and peg liquidity risk; verify jurisdiction eligibility.';
    steps = [
      `Mint or acquire ${p.name}'s yield-bearing RWA/stable asset on ${primary} ($500-$5,000 sizing; ${gasTx}).`,
      `Deploy the minted asset into whitelisted DEX pools or collateral vaults on ${primary} to stack base yield plus ecosystem points.`,
      `Hold uninterrupted for 60-90 days; ${p.name} tracks ${tvlStr} TVL with ${seasonNote} and ${fdvStr} implied value.`,
      `Keep redemption path tested with a small $50 unwind once so exit liquidity and settlement time (T+0 to T+3) are verified.`,
    ];
  } else {
    strategy_summary = `Early Ecosystem Interaction & Liquidity Footprint`;
    time_commitment = '20 min setup + 10 min/biweekly';
    risk_note = 'Early-stage architecture risk; cap allocation per wallet and use a dedicated farm address.';
    steps = [
      `Bridge $300-$1,500 into ${p.name} on ${primary} (${gasTx}); ${bridgeNote}.`,
      `Complete at least 5 core protocol actions across separate weeks (deposit, swap/transfer, and governance or staking interaction).`,
      `Keep an active balance above $250 for 45-60 days across snapshots; ${p.name} carries ${tvlStr} TVL and ${seasonNote}.`,
      `Document tx hashes and monitor ${p.name}'s official announcements for points-to-token conversion or sybil-check windows.`,
    ];
  }

  return {
    strategy_summary,
    est_gas_cost: gasTx,
    time_commitment,
    risk_note,
    steps,
  };
}
