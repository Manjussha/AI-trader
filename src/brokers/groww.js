/**
 * Groww Broker Implementation
 *
 * Required .env vars:
 *   BROKER=groww
 *   GROWW_API_KEY=<your JWT from developer.groww.in>
 *   GROWW_API_SECRET=<your API secret>
 *   TOTP_SECRET=<your TOTP base32 secret>
 *
 * Docs: https://developer.groww.in
 */
import { GrowwClient } from '../groww-client.js';
import { BaseBroker } from './base.js';

export class GrowwBroker extends BaseBroker {
  constructor(config) {
    super(config);
    this.name   = 'Groww';
    this._client = new GrowwClient({
      apiKey:     config.apiKey,
      totpSecret: config.totpSecret,
    });
  }

  async authenticate()                    { return this._client.authenticate(); }
  async placeOrder(p)                     { return this._client.placeOrder(p); }
  async cancelOrder(id, seg)              { return this._client.cancelOrder(id, seg); }
  async getHoldings()                     { return this._client.getHoldings(); }
  async getPositions()                    { return this._client.getPositions(); }
  async getFunds()                        { return this._client.getFunds(); }
  async getOrderList()                    { return this._client.getOrderList(); }
  async getOrderDetail(id, seg)           { return this._client.getOrderDetail(id, seg); }
  async searchStocks(q)                   { return this._client.searchStocks(q); }
  async getOptionChain(sym, exp, exch)    { return this._client.getOptionChain(sym, exp, exch); }
}
