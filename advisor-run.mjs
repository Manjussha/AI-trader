import { GrowwClient } from './src/groww-client.js';
import { generateSignal, rsi, sma, bollingerBands, volatility, supportResistance } from './src/analytics.js';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const client = new GrowwClient({ apiKey: process.env.GROWW_API_KEY, totpSecret: process.env.TOTP_SECRET });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Fetch everything in parallel ──────────────────────────────────────────
const [niftyRaw, bnRaw, statusRaw, gainersRaw, losersRaw, activeRaw] = await Promise.allSettled([
  client._nseRequest('/equity-stockIndices?index=NIFTY%2050'),
  client._nseRequest('/equity-stockIndices?index=NIFTY%20BANK'),
  client.getMarketStatus(),
  client.getTopGainers('NIFTY 50', 8),
  client.getTopLosers('NIFTY 50', 8),
  client.getMostActive('NIFTY 50', 5),
]);

const nifty   = niftyRaw.status  === 'fulfilled' ? niftyRaw.value?.data?.[0]  : null;
const bn      = bnRaw.status     === 'fulfilled' ? bnRaw.value?.data?.[0]     : null;
const status  = statusRaw.status === 'fulfilled' ? statusRaw.value?.marketState?.[0] : null;
const gainers = gainersRaw.status === 'fulfilled' ? gainersRaw.value : [];
const losers  = losersRaw.status  === 'fulfilled' ? losersRaw.value  : [];
const active  = activeRaw.status  === 'fulfilled' ? activeRaw.value  : [];

// ── NIFTY Technical Analysis ───────────────────────────────────────────────
let niftyTA = null;
try {
  const hist   = await client.getHistoricalDataYahoo('NIFTYBEES', 'NSE', 90, '1d');
  const closes = hist.candles.map(c => parseFloat(c.close)).filter(Boolean);
  const vols   = hist.candles.map(c => c.volume || 0);
  niftyTA = {
    rsi:    rsi(closes)?.toFixed(1),
    signal: generateSignal(closes, vols),
    sma20:  sma(closes, 20)?.toFixed(2),
    sma50:  sma(closes, 50)?.toFixed(2),
    bb:     bollingerBands(closes),
    vol:    volatility(closes)?.toFixed(1),
  };
} catch(e) {}

// ── TA on top 5 movers ─────────────────────────────────────────────────────
const moverTA = [];
for (const s of gainers.slice(0, 5)) {
  try {
    const hist   = await client.getHistoricalDataYahoo(s.symbol, 'NSE', 60, '1d');
    const closes = hist.candles.map(c => parseFloat(c.close)).filter(Boolean);
    const highs  = hist.candles.map(c => parseFloat(c.high)).filter(Boolean);
    const lows   = hist.candles.map(c => parseFloat(c.low)).filter(Boolean);
    const vols   = hist.candles.map(c => c.volume || 0);
    const sr     = supportResistance(highs, lows);
    moverTA.push({
      symbol: s.symbol, price: s.lastPrice, pChange: s.pChange,
      rsi:        rsi(closes)?.toFixed(1),
      signal:     closes.length >= 26 ? generateSignal(closes, vols) : null,
      support:    sr?.support?.toFixed(2),
      resistance: sr?.resistance?.toFixed(2),
      vol:        volatility(closes)?.toFixed(1),
      sma20:      sma(closes, 20)?.toFixed(2),
    });
  } catch {}
}

// ── News ───────────────────────────────────────────────────────────────────
let news = [];
try {
  const res  = await fetch('https://finance.yahoo.com/rss/headline?s=%5ENSEI,%5EBSESN,RELIANCE.NS', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const xml  = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  news = items.slice(0, 10).map(m => {
    const raw   = m[1];
    const title = (raw.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || raw.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    return title.trim();
  }).filter(Boolean);
} catch {}

const niftyLevel = nifty?.lastPrice || 0;
const bnLevel    = bn?.lastPrice    || 0;
const bbUpper    = niftyTA?.bb?.upper?.toFixed(1);
const bbMiddle   = niftyTA?.bb?.middle?.toFixed(1);
const bbLower    = niftyTA?.bb?.lower?.toFixed(1);

// ── User profile (from answers) ────────────────────────────────────────────
const userProfile = `
USER PROFILE (answers just given):
- Trading time: Available during market hours (9:15 AM - 3:30 PM)
- F&O experience: YES — has traded F&O before AND made profit
- Background: Full-stack developer at AngelOne (understands trading systems, APIs, order flow deeply)
- Hold style: Flexible — depends on the position quality
- Goal: MAXIMUM PROFIT using AI as an edge. Not interested in sector education. AI = profit amplifier
- Mode: EXPERIMENT budget (small capital allocation per trade, but execute like a pro trader)
- F&O status: ACTIVATED on Groww account — ready to trade options/futures NOW
- Trading style: BOTH intraday and positional (whatever gives best opportunity)
- Mindset: Tech-first, data-driven, trusts AI signals over emotion`;

const systemPrompt = `You are an elite Indian prop trader AI. The user is a FORMER ANGELONE FULL-STACK DEVELOPER who has made profits in F&O before. They deeply understand trading infrastructure. Skip all basics — go straight to pro-level specific trades.

${userProfile}

Today: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
Market: ${status?.marketStatus || 'Open'}

RULES: Be hyper-specific. Give exact strikes, entries, targets, SL. Think like a prop desk. Exploit today's specific momentum. Minimum 3:1 R:R on every trade.`;

const userMessage = `LIVE MARKET DATA RIGHT NOW:

NIFTY 50: ${niftyLevel} | Change: ${nifty?.pChange}% | H: ${nifty?.dayHigh} L: ${nifty?.dayLow}
BANKNIFTY: ${bnLevel} | Change: ${bn?.pChange}% | H: ${bn?.dayHigh} L: ${bn?.dayLow}

NIFTY TECHNICALS:
- RSI(14): ${niftyTA?.rsi} | Signal: ${niftyTA?.signal?.signal} (${niftyTA?.signal?.confidence}% confidence)
- SMA20: ${niftyTA?.sma20} | SMA50: ${niftyTA?.sma50}
- Bollinger: L=${bbLower} M=${bbMiddle} U=${bbUpper}
- Volatility: ${niftyTA?.vol}% annual

TOP GAINERS:
${gainers.map(s => `${s.symbol}: Rs.${s.lastPrice} +${s.pChange}% Vol:${s.volume?.toLocaleString?.('en-IN')}`).join('\n')}

TOP LOSERS:
${losers.map(s => `${s.symbol}: Rs.${s.lastPrice} ${s.pChange}% Vol:${s.volume?.toLocaleString?.('en-IN')}`).join('\n')}

MOST ACTIVE:
${active.map(s => `${s.symbol}: Rs.${s.lastPrice} ${s.pChange}% Vol:${s.volume?.toLocaleString?.('en-IN')}`).join('\n')}

DEEP TA ON TOP MOVERS:
${moverTA.map(s => `${s.symbol} Rs.${s.price} (+${s.pChange}%) | RSI:${s.rsi} | Signal:${s.signal?.signal}(${s.signal?.confidence}%) | Vol:${s.vol}% | Support:Rs.${s.support} | Resistance:Rs.${s.resistance} | vs SMA20(${s.sma20}):${parseFloat(s.price) > parseFloat(s.sma20) ? 'ABOVE' : 'BELOW'}`).join('\n')}

F&O COSTS:
NIFTY lot=75 | Futures margin ~Rs.${Math.round(niftyLevel*75*0.12).toLocaleString('en-IN')} | ATM option ~Rs.${Math.round(niftyLevel*0.006*75).toLocaleString('en-IN')}/lot
BANKNIFTY lot=35 | Futures margin ~Rs.${Math.round(bnLevel*35*0.12).toLocaleString('en-IN')} | ATM option ~Rs.${Math.round(bnLevel*0.008*35).toLocaleString('en-IN')}/lot
RELIANCE lot=250 | BEL lot=4350 | HINDALCO lot=700 | COALINDIA lot=1400
Weekly expiry: Thursday

NEWS:
${news.slice(0, 8).join('\n')}

---
BUILD THE COMPLETE PLAN:

## 1. MARKET MOOD & TODAY'S EDGE
What specific inefficiency/momentum can we exploit today? What do FIIs likely doing?

## 2. TOP 3 TRADES (Pro Format)
For each:
- TRADE: [action] [symbol] [type]
- Strike & Expiry (F&O)
- Entry: Rs.X | Target 1: Rs.X | Target 2: Rs.X | SL: Rs.X
- R:R: X:1 | Capital: Rs.X | Expected P&L: +Rs.X / -Rs.X max
- WHY: (data-backed, specific to today's price action)
- TIMING: Exact entry window

## 3. CAPITAL TIERS
| Budget | Best Instrument | Trade | Expected P&L |
|--------|----------------|-------|-------------|
| Rs.5,000 | | | |
| Rs.15,000 | | | |
| Rs.50,000 | | | |

## 4. INTRADAY SCHEDULE (9:15 to 3:30)
Time-tagged action plan

## 5. HARD RISK RULES FOR TODAY
Based on today's specific volatility and market structure

## 6. POSITIONAL WATCH (1-3 day holds)
Any setups forming for tomorrow/next week?`;

process.stderr.write('Analyzing live data with Claude Opus...\n\n');

const response = await anthropic.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});

console.log(response.content[0]?.text || 'No response');
console.log('\n---');
console.log(`NIFTY: ${niftyLevel} (${nifty?.pChange}%) | BANKNIFTY: ${bnLevel} (${bn?.pChange}%) | RSI: ${niftyTA?.rsi} | Signal: ${niftyTA?.signal?.signal}`);
