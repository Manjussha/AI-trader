/**
 * Zerodha Kite Connect Broker Implementation
 *
 * Required .env vars:
 *   BROKER=zerodha
 *   ZERODHA_API_KEY=<from kite.trade/app>
 *   ZERODHA_API_SECRET=<from kite.trade/app>
 *   ZERODHA_REQUEST_TOKEN=<from OAuth redirect — refresh daily>
 *   ZERODHA_ACCESS_TOKEN=<cached access token (auto-set after auth)>
 *
 * Docs: https://kite.trade/docs/connect/v3
 * Base URL: https://api.kite.trade
 *
 * NOTE: Kite uses OAuth. Run once manually:
 *   1. Open: https://kite.trade/connect/login?api_key=YOUR_KEY&v=3
 *   2. Login → you'll get redirected to your redirect_url?request_token=XXXX
 *   3. Set ZERODHA_REQUEST_TOKEN=XXXX in .env
 *   4. Bot will exchange it for access_token on first run
 */
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { BaseBroker } from './base.js';

const BASE = 'https://api.kite.trade';

export class ZerodhaBroker extends BaseBroker {
  constructor(config) {
    super(config);
    this.name  = 'Zerodha';
    this.token = config.accessToken || null;
  }

  async _req(path, method = 'GET', params = null) {
    const headers = {
      'X-Kite-Version': '3',
      'Authorization':  `token ${this.config.apiKey}:${this.token}`,
    };
    let url = `${BASE}${path}`;
    let body;
    if (method === 'GET' && params) {
      url += '?' + new URLSearchParams(params).toString();
    } else if (params) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(params).toString();
    }
    const res  = await fetch(url, { method, headers, body });
    const json = await res.json();
    if (json.status === 'error') throw new Error(`Zerodha: ${json.message}`);
    return json.data;
  }

  async authenticate() {
    const checksum = createHash('sha256')
      .update(this.config.apiKey + this.config.requestToken + this.config.apiSecret)
      .digest('hex');
    const data = await fetch(`${BASE}/session/token`, {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: this.config.apiKey, request_token: this.config.requestToken, checksum }),
    }).then(r => r.json());
    if (data.status === 'error') throw new Error(`Zerodha auth: ${data.message}`);
    this.token = data.data.access_token;
    return this.token;
  }

  async getHoldings()  { return this._req('/portfolio/holdings'); }
  async getPositions() { return this._req('/portfolio/positions').then(d => [...(d?.net || []), ...(d?.day || [])]); }
  async getFunds() {
    const d = await this._req('/user/margins');
    return { available: d?.equity?.available?.live_balance, used: d?.equity?.utilised?.debits, total: d?.equity?.net };
  }
  async getOrderList()           { return this._req('/orders'); }
  async getOrderDetail(orderId)  { return this._req(`/orders/${orderId}`); }
  async cancelOrder(orderId)     { return this._req(`/orders/regular/${orderId}`, 'DELETE'); }
  async searchStocks(query)      { return this._req('/instruments', 'GET', { exchange: 'NSE', tradingsymbol: query }); }

  async placeOrder(p) {
    return this._req('/orders/regular', 'POST', {
      tradingsymbol:   p.trading_symbol,
      exchange:        p.exchange,
      transaction_type: p.transaction_type,
      order_type:      p.order_type,
      quantity:        p.quantity,
      product:         p.product === 'CNC' ? 'CNC' : p.product === 'INTRADAY' ? 'MIS' : 'NRML',
      price:           p.price || 0,
      trigger_price:   p.trigger_price || 0,
      validity:        p.validity || 'DAY',
      tag:             p.order_reference_id || '',
    });
  }
}
