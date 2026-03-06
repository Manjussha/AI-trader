/**
 * Groww Trading API Client
 * Based on official docs: https://groww.in/trade-api/docs/curl
 * Base URL: https://api.groww.in/v1
 *
 * Auth flow (TOTP):
 *   POST /token/api/access
 *   Body: { key_type: "totp", totp: "<6-digit code>" }
 *   Header: Authorization: Bearer <TOTP_TOKEN>
 *   Returns: access_token (valid until 6AM next day)
 */

import fetch from 'node-fetch';
import { createHmac } from 'crypto';

const BASE = 'https://api.groww.in/v1';

// NSE India public API (no auth)
const NSE = 'https://www.nseindia.com/api';

// Yahoo Finance (historical data fallback)
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ─── TOTP generator ────────────────────────────────────────────────────────
function base32Decode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0;
  const out = [];
  for (const c of str) {
    val = (val << 5) | chars.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); }
  }
  return Buffer.from(out);
}

export function generateTOTP(secret) {
  const key = base32Decode(secret.trim());
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
  return String(code % 1000000).padStart(6, '0');
}

// ─── GrowwClient ───────────────────────────────────────────────────────────
export class GrowwClient {
  constructor({ apiKey, totpSecret }) {
    this.totpToken = apiKey;      // The auth-totp JWT from Groww API Keys page
    this.totpSecret = totpSecret; // The TOTP secret (from QR code)
    this.accessToken = null;      // Full access token (obtained after TOTP exchange)
    this._nseCookies = null;
  }

  // ─── Auth: Exchange TOTP token → access token ───────────────────────────
  async authenticate() {
    const totp = generateTOTP(this.totpSecret);
    const res = await fetch(`${BASE}/token/api/access`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.totpToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-VERSION': '1.0',
      },
      body: JSON.stringify({ key_type: 'totp', totp }),
    });
    const data = await res.json();

    if (!res.ok || data.status === 'FAILURE') {
      throw new Error(`Auth failed: ${JSON.stringify(data)}`);
    }

    // Token is inside payload
    this.accessToken = data?.payload?.access_token || data?.access_token || data?.token;
    if (!this.accessToken) throw new Error(`No access token in response: ${JSON.stringify(data)}`);
    return this.accessToken;
  }

  // Ensure we have a valid access token, auto-authenticate if not
  async _ensureAuth() {
    if (!this.accessToken) await this.authenticate();
    return this.accessToken;
  }

  // ─── Groww API request ──────────────────────────────────────────────────
  async _request(method, path, body = null, retry = true) {
    const token = await this._ensureAuth();
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-VERSION': '1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();

    // Token expired → re-authenticate once
    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this._request(method, path, body, false);
    }

    if (!res.ok || data?.status === 'FAILURE') {
      throw new Error(`Groww API ${res.status}: ${JSON.stringify(data?.error || data)}`);
    }

    return data?.payload ?? data;
  }

  // ─── NSE India public market data ───────────────────────────────────────
  async _getNseCookies() {
    if (this._nseCookies) return this._nseCookies;
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    // Two-step: homepage then market-data page to collect full cookie set
    const r1 = await fetch('https://www.nseindia.com', { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
    const r2 = await fetch('https://www.nseindia.com/market-data/live-equity-market', { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': 'https://www.nseindia.com/' } });
    const raw = [r1.headers.get('set-cookie') || '', r2.headers.get('set-cookie') || ''].join(',');
    this._nseCookies = raw.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    return this._nseCookies;
  }

  async _nseRequest(path) {
    const cookies = await this._getNseCookies();
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const res = await fetch(`${NSE}${path}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies,
      }
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return {}; }
  }

  // Option chain — puppeteer intercepts option-chain-v3 XHR made by the NSE page
  async _nseOptionChain(symbol, isIndex = true) {
    let browser;
    try {
      const puppeteer = (await import('puppeteer')).default;
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

      let chainData = null;
      page.on('response', async res => {
        const url = res.url();
        if (url.includes('option-chain-v3') && url.includes(encodeURIComponent(symbol))) {
          try { chainData = await res.json(); } catch {}
        }
      });

      await page.goto('https://www.nseindia.com/option-chain', { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Wait for the XHR to complete (page loads it on startup)
      await new Promise(r => setTimeout(r, 6000));

      return chainData || { error: 'No option chain data received' };
    } catch (e) {
      return { error: e.message };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  // ─── ACCOUNT ─────────────────────────────────────────────────────────────

  async getHoldings() {
    return this._request('GET', '/portfolio/holdings');
  }

  async getPositions(segment = null) {
    const q = segment ? `?segment=${segment}` : '';
    return this._request('GET', `/portfolio/positions${q}`);
  }

  async getFunds() {
    return this._request('GET', '/portfolio/margin');
  }

  // ─── ORDERS ──────────────────────────────────────────────────────────────

  async placeOrder({ trading_symbol, exchange, segment = 'CASH', transaction_type,
    quantity, order_type = 'MARKET', product = 'CNC', price = 0,
    trigger_price = 0, validity = 'DAY', order_reference_id }) {
    return this._request('POST', '/order/create', {
      trading_symbol, exchange, segment, transaction_type,
      quantity, order_type, product, price, trigger_price, validity,
      ...(order_reference_id && { order_reference_id }),
    });
  }

  async modifyOrder({ groww_order_id, segment, quantity, order_type, price = 0, trigger_price = 0 }) {
    return this._request('POST', `/order/modify`, { groww_order_id, segment, quantity, order_type, price, trigger_price });
  }

  async cancelOrder(groww_order_id, segment = 'CASH') {
    return this._request('POST', '/order/cancel', { groww_order_id, segment });
  }

  async getOrderList({ segment, page = 0, page_size = 50 } = {}) {
    const q = new URLSearchParams({ page, page_size, ...(segment && { segment }) });
    return this._request('GET', `/order/list?${q}`);
  }

  async getOrderDetail(groww_order_id, segment = 'CASH') {
    return this._request('GET', `/order/detail/${groww_order_id}?segment=${segment}`);
  }

  // ─── LIVE MARKET DATA (Groww API) ────────────────────────────────────────

  async getQuote(trading_symbol, exchange = 'NSE', segment = 'CASH') {
    return this._request('GET', `/market/quote?exchange=${exchange}&segment=${segment}&trading_symbol=${trading_symbol}`);
  }

  async getLTP(symbols, segment = 'CASH') {
    // symbols: array of "NSE:RELIANCE" or just "RELIANCE"
    const list = symbols.map(s => s.includes(':') ? s : `NSE:${s}`).join(',');
    return this._request('GET', `/market/ltp?segment=${segment}&exchange_trading_symbols=${encodeURIComponent(list)}`);
  }

  async getOHLC(symbols, segment = 'CASH') {
    const list = symbols.map(s => s.includes(':') ? s : `NSE:${s}`).join(',');
    return this._request('GET', `/market/ohlc?segment=${segment}&exchange_trading_symbols=${encodeURIComponent(list)}`);
  }

  async getOptionChain(underlying, expiry_date, exchange = 'NSE') {
    return this._request('GET', `/market/option-chain?exchange=${exchange}&underlying=${underlying}&expiry_date=${expiry_date}`);
  }

  // ─── HISTORICAL DATA (Groww API) ─────────────────────────────────────────

  async getHistoricalData(trading_symbol, exchange = 'NSE', segment = 'CASH',
    startDate, endDate, interval_in_minutes = 1440) {
    // Convert dates to epoch ms if string format given
    const start = typeof startDate === 'string' ? new Date(startDate).getTime() : startDate;
    const end   = typeof endDate   === 'string' ? new Date(endDate).getTime()   : endDate;
    return this._request('GET',
      `/historical/candles?exchange=${exchange}&segment=${segment}&trading_symbol=${trading_symbol}` +
      `&start_time=${start}&end_time=${end}&interval_in_minutes=${interval_in_minutes}`
    );
  }

  // Yahoo Finance fallback for historical data (public)
  async getHistoricalDataYahoo(symbol, exchange = 'NSE', days = 90, interval = '1d') {
    const suffix = exchange === 'BSE' ? '.BO' : '.NS';
    const rangeMap = { 7: '1wk', 30: '1mo', 90: '3mo', 180: '6mo', 365: '1y', 730: '2y' };
    const range = rangeMap[days] || '3mo';
    const url = `${YAHOO}/${symbol.toUpperCase()}${suffix}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data from Yahoo Finance');
    const ts = result.timestamp;
    const ohlcv = result.indicators?.quote?.[0];
    return {
      symbol: `${symbol.toUpperCase()}${suffix}`,
      candles: ts.map((t, i) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        open: ohlcv?.open?.[i]?.toFixed(2),
        high: ohlcv?.high?.[i]?.toFixed(2),
        low:  ohlcv?.low?.[i]?.toFixed(2),
        close: ohlcv?.close?.[i]?.toFixed(2),
        volume: ohlcv?.volume?.[i],
      })).filter(c => c.close !== null && c.close !== undefined),
      meta: {
        regularMarketPrice: result.meta?.regularMarketPrice,
        fiftyTwoWeekHigh: result.meta?.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: result.meta?.fiftyTwoWeekLow,
      }
    };
  }

  // ─── NSE MARKET DATA (public, no auth needed) ────────────────────────────

  async getMarketStatus() {
    return this._nseRequest('/marketStatus');
  }

  async getLivePriceNSE(symbol) {
    return this._nseRequest(`/quote-equity?symbol=${encodeURIComponent(symbol.toUpperCase())}`);
  }

  async getIndex(index = 'NIFTY 50') {
    return this._nseRequest(`/equity-stockIndices?index=${encodeURIComponent(index)}`);
  }

  async getTopGainers(indexName = 'NIFTY 50', limit = 10) {
    const data = await this.getIndex(indexName);
    return (data?.data || [])
      .filter(s => s.pChange !== undefined && s.symbol !== indexName)
      .sort((a, b) => b.pChange - a.pChange)
      .slice(0, limit)
      .map(s => ({ symbol: s.symbol, lastPrice: s.lastPrice, change: s.change, pChange: s.pChange, high: s.dayHigh, low: s.dayLow, volume: s.totalTradedVolume }));
  }

  async getTopLosers(indexName = 'NIFTY 50', limit = 10) {
    const data = await this.getIndex(indexName);
    return (data?.data || [])
      .filter(s => s.pChange !== undefined && s.symbol !== indexName)
      .sort((a, b) => a.pChange - b.pChange)
      .slice(0, limit)
      .map(s => ({ symbol: s.symbol, lastPrice: s.lastPrice, change: s.change, pChange: s.pChange, high: s.dayHigh, low: s.dayLow, volume: s.totalTradedVolume }));
  }

  async getMostActive(indexName = 'NIFTY 50', limit = 10) {
    const data = await this.getIndex(indexName);
    return (data?.data || [])
      .filter(s => s.totalTradedVolume && s.symbol !== indexName)
      .sort((a, b) => b.totalTradedVolume - a.totalTradedVolume)
      .slice(0, limit)
      .map(s => ({ symbol: s.symbol, lastPrice: s.lastPrice, pChange: s.pChange, volume: s.totalTradedVolume }));
  }

  async getSectorIndices() {
    return this._nseRequest('/allIndices');
  }

  // Groww web search (works without full auth)
  async searchStocks(query) {
    const res = await fetch(`https://groww.in/v1/api/search/v1/entity?text=${encodeURIComponent(query)}&page=0&size=10`, {
      headers: { 'Authorization': `Bearer ${this.totpToken}`, 'Accept': 'application/json' }
    });
    return res.json();
  }
}
