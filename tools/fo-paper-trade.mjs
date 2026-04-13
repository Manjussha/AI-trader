// Paper-trade the F&O research bullish scalps via BS-priced ATM CE.
import { GrowwClient } from '../src/groww-client.js';
import { greeks } from '../src/fo-skill.js';
import { paperBuyOption, getPortfolio, getOrders } from '../src/paper-trade.js';

const m = new GrowwClient({ apiKey: '', totpSecret: '' });
const fmt = n => (typeof n === 'number' ? n.toFixed(2) : n);

async function getLast(urlName) {
  const d = await m._nseRequest(`/equity-stockIndices?index=${encodeURIComponent(urlName)}`);
  const row = d?.data?.find(x => x.priority === 1) || d?.data?.[0];
  return +row.lastPrice;
}

async function getVIX() {
  try {
    const v = await m._nseRequest('/allIndices');
    const row = v?.data?.find(d => /VIX/i.test(d.index || d.indexName || ''));
    return row ? +row.last : 20;
  } catch { return 20; }
}

// Round to nearest strike interval
function atmStrike(spot, step) { return Math.round(spot / step) * step; }

// Weekly expiry — next Thursday
function nextThursday() {
  const d = new Date();
  const offset = (4 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

(async () => {
  console.log('\n═══ F&O PAPER TRADE — BULL SCALP BASKET ═══\n');

  const [nifty, bank, fin, vix] = await Promise.all([
    getLast('NIFTY 50'), getLast('NIFTY BANK'), getLast('NIFTY FIN SERVICE'), getVIX(),
  ]);

  const expiry = nextThursday();
  const dte = Math.max(1, Math.ceil((new Date(expiry) - new Date()) / (1000*60*60*24)));
  const T = dte / 365;
  const r = 0.065;
  const iv = Math.max(0.15, Math.min(0.35, vix / 100)); // use VIX as proxy

  console.log(`Spots:  NIFTY ${fmt(nifty)}  BANK ${fmt(bank)}  FIN ${fmt(fin)}   VIX ${fmt(vix)}`);
  console.log(`Expiry: ${expiry}  (DTE: ${dte})   IV used: ${(iv*100).toFixed(1)}%   r: ${(r*100).toFixed(1)}%\n`);

  const trades = [
    { sym: 'NIFTY',     spot: nifty, step: 50,  lot: 75, bias: 5 },
    { sym: 'BANKNIFTY', spot: bank,  step: 100, lot: 30, bias: 5 },
    { sym: 'FINNIFTY',  spot: fin,   step: 50,  lot: 40, bias: 6 },
  ];

  for (const t of trades) {
    const K = atmStrike(t.spot, t.step);
    const g = greeks(t.spot, K, T, r, iv, 'CE');
    const premium = Math.max(1, +g.premium.toFixed(1));

    console.log(`━━━ ${t.sym} ATM ${K} CE ━━━`);
    console.log(`  Spot:     ${fmt(t.spot)}`);
    console.log(`  Premium:  ₹${premium}  (BS theo, IV ${(iv*100).toFixed(0)}%)`);
    console.log(`  Delta:    ${g.delta.toFixed(3)}   Gamma: ${g.gamma.toFixed(5)}`);
    console.log(`  Theta/d:  ₹${g.theta.toFixed(2)}   Vega: ₹${g.vega.toFixed(2)}/vol-pt`);

    const res = paperBuyOption({
      symbol: t.sym, strike: K, type: 'CE', expiry,
      premium, lots: 1, lotSize: t.lot,
      note: `10min bull scalp, bias ${t.bias}/7, VIX ${vix.toFixed(1)}`
    });

    if (res.success) {
      const cost = premium * t.lot;
      const targetPrem = premium * 1.20;   // +20% scalp target
      const slPrem = premium * 0.85;       // -15% stop
      console.log(`  ✅ BOUGHT 1 lot (${t.lot}) @ ₹${premium}   cost: ₹${cost.toFixed(0)}`);
      console.log(`     T1 (+20%): ₹${targetPrem.toFixed(1)}   SL (-15%): ₹${slPrem.toFixed(1)}`);
      console.log(`     Spot target: ${fmt(t.spot + g.gamma * 0 + 0.2 * premium / g.delta)}`);
      console.log(`     Cash left: ₹${res.cashRemaining}\n`);
    } else {
      console.log(`  ❌ ${res.error}\n`);
    }
  }

  console.log('\n═══ PORTFOLIO AFTER TRADES ═══\n');
  const p = getPortfolio();
  console.log(`Cash:            ₹${p.cash}`);
  console.log(`Portfolio value: ₹${p.portfolioValue}`);
  console.log(`Unrealized P&L:  ₹${p.unrealizedPnl}`);
  console.log(`Realized P&L:    ₹${p.realizedPnl}`);
  console.log(`Total return:    ${p.totalReturn}`);
  console.log(`Total trades:    ${p.totalTrades}   Win-rate: ${p.winRate}`);
  console.log(`\nOpen positions:`);
  p.holdings.forEach(h => {
    if (h.type === 'OPTION') {
      console.log(`  ${h.symbol} ${h.strike} ${h.optType} ${h.expiry}  lots=${h.lots}  @₹${h.premium}  value=₹${h.currentValue}`);
    } else {
      console.log(`  ${h.symbol}  qty=${h.qty}  avg=₹${h.avgPrice}  ltp=₹${h.ltp}  P&L=₹${h.unrealizedPnl}`);
    }
  });

  console.log('\n═══ LAST 5 ORDERS ═══');
  getOrders(5).forEach(o => {
    console.log(`  ${o.timestamp.slice(11,19)}  ${o.type.padEnd(12)}  ${o.symbol || o.key}  ${o.premium? `@₹${o.premium}`:''}  note: ${o.note||''}`);
  });

  console.log('\n✅ Done. Run `node dashboards/portfolio-view.mjs` or `npm run portfolio` to watch live.\n');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
