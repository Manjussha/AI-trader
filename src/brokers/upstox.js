/**
 * Upstox v2 API Broker Implementation
 *
 * Required .env vars:
 *   BROKER=upstox
 *   UPSTOX_API_KEY=<from developer.upstox.com>
 *   UPSTOX_API_SECRET=<your secret>
 *   UPSTOX_REDIRECT_URI=http://localhost:3000/callback
 *   UPSTOX_ACCESS_TOKEN=<OAuth2 token — refresh daily or use TOTP flow>
 *   UPSTOX_CODE=<authorization code from OAuth redirect — used once>
 *
 * Docs: https://upstox.com/developer/api-documentation
 * Base URL: https://api.upstox.com/v2
 *
 * Auth flow:
 *   1. Open: https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=YOUR_KEY&redirect_uri=YOUR_URI
 *   2. After login, get `code` from redirect URL
 *   3. Set UPSTOX_CODE=<code> in .env — bot exchanges it for access_token on first run
 */
import fetch from 'node-fetch';
import { BaseBroker } from './base.js';

const BASE = 'https://api.upstox.com/v2';

export class UpstoxBroker extends BaseBroker {
  constructor(config) {
    super(config);
    this.name  = 'Upstox';
    this.token = config.accessToken || null;
  }

  async _req(path, method = 'GET', body = null) {
    const headers = {
      'Accept':        'application/json',
      'Authorization': `Bearer ${this.token}`,
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res  = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (json.status === 'error') throw new Error(`Upstox: ${json.errors?.[0]?.message || json.message}`);
    return json.data;
  }

  async authenticate() {
    if (this.token) return this.token;
    const res = await fetch(`${BASE}/login/authorization/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code:          this.config.code,
        client_id:     this.config.apiKey,
        client_secret: this.config.apiSecret,
        redirect_uri:  this.config.redirectUri || 'http://localhost:3000/callback',
        grant_type:    'authorization_code',
      }),
    }).then(r => r.json());
    if (!res.access_token) throw new Error(`Upstox auth failed: ${JSON.stringify(res)}`);
    this.token = res.access_token;
    return this.token;
  }

  async getHoldings() {
    const d = await this._req('/portfolio/long-term-holdings');
    return d || [];
  }

  async getPositions() {
    const d = await this._req('/portfolio/short-term-positions');
    return d || [];
  }

  async getFunds() {
    const d = await this._req('/user/fund-and-margin?segment=SEC');
    return { available: d?.equity?.available_margin, used: d?.equity?.used_margin, total: d?.equity?.notional_cash };
  }

  async getOrderList()         { return this._req('/order/retrieve-all'); }
  async getOrderDetail(id)     { return this._req(`/order/details?order_id=${id}`); }
  async cancelOrder(id)        { return this._req(`/order/cancel?order_id=${id}`, 'DELETE'); }

  async placeOrder(p) {
    return this._req('/order/place', 'POST', {
      quantity:         p.quantity,
      product:          p.product === 'CNC' ? 'D' : 'I',
      validity:         p.validity || 'DAY',
      price:            p.price || 0,
      tag:              p.order_reference_id || '',
      instrument_token: `NSE_EQ|${p.trading_symbol}`,  // adjust for FNO: NSE_FO|...
      order_type:       p.order_type,
      transaction_type: p.transaction_type,
      disclosed_quantity: 0,
      trigger_price:    p.trigger_price || 0,
      is_amo:           false,
    });
  }

  async searchStocks(query) {
    return this._req(`/market-quote/search?q=${encodeURIComponent(query)}&asset_type=equity`);
  }
}
