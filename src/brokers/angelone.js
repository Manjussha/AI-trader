/**
 * AngelOne Smart API Broker Implementation
 *
 * Required .env vars:
 *   BROKER=angelone
 *   ANGELONE_API_KEY=<your API key from smartapi.angelbroking.com>
 *   ANGELONE_CLIENT_ID=<your client ID / user ID>
 *   ANGELONE_PASSWORD=<your trading password>
 *   ANGELONE_TOTP_SECRET=<your TOTP secret>
 *
 * Docs: https://smartapi.angelbroking.com/docs
 * Base URL: https://apiconnect.angelbroking.com
 */
import fetch from 'node-fetch';
import { BaseBroker } from './base.js';
import { createHmac } from 'crypto';

const BASE = 'https://apiconnect.angelbroking.com';

// Simple TOTP generator (same algorithm as src/totp.js)
function generateTOTP(secret) {
  const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = secret.replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const ch of s) {
    const v = base32.indexOf(ch);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key    = Buffer.from(bytes);
  const epoch  = Math.floor(Date.now() / 1000 / 30);
  const msg    = Buffer.alloc(8);
  msg.writeBigInt64BE(BigInt(epoch));
  const hmac   = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code   = ((hmac[offset] & 0x7f) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3]) % 1000000;
  return code.toString().padStart(6, '0');
}

export class AngelOneBroker extends BaseBroker {
  constructor(config) {
    super(config);
    this.name  = 'AngelOne';
    this.token = null;
  }

  async _req(path, method = 'GET', body = null) {
    const headers = {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-UserType':    'USER',
      'X-SourceID':    'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress':  '00:00:00:00:00:00',
      'X-PrivateKey':  this.config.apiKey,
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.status && json.errorcode) throw new Error(`AngelOne: ${json.message} (${json.errorcode})`);
    return json.data ?? json;
  }

  async authenticate() {
    const totp = generateTOTP(this.config.totpSecret);
    const data = await this._req('/rest/auth/angelbroking/user/v1/loginByPassword', 'POST', {
      clientcode: this.config.clientId,
      password:   this.config.password,
      totp,
    });
    this.token = data.jwtToken;
    return this.token;
  }

  async getHoldings() {
    const d = await this._req('/rest/secure/angelbroking/portfolio/v1/getAllHolding');
    return d?.holdings || [];
  }

  async getPositions() {
    const d = await this._req('/rest/secure/angelbroking/order/v1/getPosition');
    return d || [];
  }

  async getFunds() {
    const d = await this._req('/rest/secure/angelbroking/user/v1/getRMS');
    return {
      available: d?.availablecash,
      used:      d?.utilisedamount,
      total:     d?.net,
    };
  }

  async getOrderList() {
    return this._req('/rest/secure/angelbroking/order/v1/getOrderBook');
  }

  async getOrderDetail(orderId) {
    const orders = await this.getOrderList();
    return orders?.find?.(o => o.orderid === orderId) || null;
  }

  async placeOrder(p) {
    // Map standard params → AngelOne format
    const variety = p.order_type === 'MARKET' ? 'NORMAL' : p.order_type.includes('SL') ? 'STOPLOSS' : 'NORMAL';
    return this._req('/rest/secure/angelbroking/order/v1/placeOrder', 'POST', {
      variety,
      tradingsymbol:  p.trading_symbol,
      symboltoken:    p.symbol_token || '',   // required — fetch via searchScrip
      transactiontype: p.transaction_type,
      exchange:       p.exchange,
      ordertype:      p.order_type,
      producttype:    p.product === 'INTRADAY' ? 'INTRADAY' : 'DELIVERY',
      duration:       p.validity || 'DAY',
      price:          p.price?.toString() || '0',
      triggerprice:   p.trigger_price?.toString() || '0',
      quantity:       p.quantity?.toString(),
    });
  }

  async cancelOrder(orderId) {
    return this._req('/rest/secure/angelbroking/order/v1/cancelOrder', 'POST', {
      variety:  'NORMAL',
      orderid:  orderId,
    });
  }

  async searchStocks(query) {
    return this._req(`/rest/secure/angelbroking/order/v1/searchScrip?exchange=NSE&searchscrip=${encodeURIComponent(query)}`);
  }
}
