import dotenv from 'dotenv'; dotenv.config();
import { GrowwClient } from '../src/groww-client.js';

const client = new GrowwClient({ apiKey: process.env.GROWW_API_KEY, totpSecret: process.env.TOTP_SECRET });
await client.authenticate();
console.log('Groww connected!');

const check = async () => {
  const [funds, holdings, positions, nifty, bank] = await Promise.all([
    client.getFunds().catch(e => ({ error: e.message })),
    client.getHoldings().catch(() => []),
    client.getPositions().catch(() => []),
    client._nseRequest('/equity-stockIndices?index=NIFTY%2050').catch(() => null),
    client._nseRequest('/equity-stockIndices?index=NIFTY%20BANK').catch(() => null),
  ]);

  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log('\n=== GROWW LIVE DASHBOARD [' + time + '] ===');

  // Funds
  if (funds && !funds.error) {
    const fno = funds.fno_margin_details;
    console.log('FUNDS:');
    console.log('  Cash Available:    ₹' + funds.clear_cash);
    console.log('  FnO Available:     ₹' + (fno?.future_balance_available || 0));
    console.log('  Margin Used:       ₹' + funds.net_margin_used);
    console.log('  Collateral:        ₹' + funds.collateral_available);
  } else {
    console.log('FUNDS: Error -', funds?.error);
  }

  // Holdings
  console.log('\nHOLDINGS (' + (Array.isArray(holdings) ? holdings.length : 0) + '):');
  if (Array.isArray(holdings) && holdings.length > 0) {
    let totalInvested = 0, totalCurrent = 0;
    holdings.forEach(h => {
      const invested = h.average_price * h.quantity;
      const current = (h.ltp || h.average_price) * h.quantity;
      const pnl = current - invested;
      const pnlPct = ((pnl / invested) * 100).toFixed(2);
      totalInvested += invested;
      totalCurrent += current;
      console.log('  ' + h.trading_symbol.padEnd(15) + ' Qty:' + String(h.quantity).padEnd(6) + ' Avg:₹' + String(h.average_price).padEnd(10) + ' LTP:₹' + String(h.ltp || 'N/A').padEnd(10) + ' P&L:' + (pnl >= 0 ? '+' : '') + '₹' + pnl.toFixed(0) + ' (' + pnlPct + '%)');
    });
    const totalPnl = totalCurrent - totalInvested;
    console.log('  ─────────────────────────────────────────────────────');
    console.log('  TOTAL Invested: ₹' + totalInvested.toFixed(0) + ' | Current: ₹' + totalCurrent.toFixed(0) + ' | P&L: ' + (totalPnl >= 0 ? '+' : '') + '₹' + totalPnl.toFixed(0));
  } else {
    console.log('  No holdings');
  }

  // Positions (intraday/F&O)
  console.log('\nPOSITIONS (' + (Array.isArray(positions) ? positions.length : 0) + '):');
  if (Array.isArray(positions) && positions.length > 0) {
    positions.forEach(p => {
      console.log('  ' + JSON.stringify(p));
    });
  } else {
    console.log('  No open positions (flat)');
  }

  // Market snapshot
  if (nifty) {
    const n = nifty.data[0];
    const b = bank?.data[0];
    console.log('\nMARKET:');
    console.log('  NIFTY:     ' + n.lastPrice + ' (' + (n.pChange > 0 ? '+' : '') + n.pChange + '%) | Range: ' + n.dayLow + ' - ' + n.dayHigh);
    if (b) console.log('  BANKNIFTY: ' + b.lastPrice + ' (' + (b.pChange > 0 ? '+' : '') + b.pChange + '%) | Range: ' + b.dayLow + ' - ' + b.dayHigh);
  }
  console.log('════════════════════════════════════════════════════════');
};

// Run immediately then every 15 seconds
await check();
setInterval(check, 15000);
