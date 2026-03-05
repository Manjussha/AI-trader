/**
 * BaseBroker — Abstract interface every broker must implement
 *
 * To add a new broker:
 *   1. Create src/brokers/your-broker.js
 *   2. Extend BaseBroker and implement all methods below
 *   3. Register it in src/brokers/index.js
 *   4. Set BROKER=your-broker in .env
 *
 * Market data (NSE India + Yahoo Finance) is FREE and shared across all
 * brokers — you do NOT need to implement price fetching in your broker.
 * Only implement authenticated account/order operations.
 */
export class BaseBroker {
  constructor(config = {}) {
    if (new.target === BaseBroker) {
      throw new Error('BaseBroker is abstract. Use a concrete broker implementation.');
    }
    this.config = config;
    this.name   = 'BASE';
  }

  /** Authenticate with broker. Returns access token string. */
  async authenticate() { throw new Error(`${this.name}: authenticate() not implemented`); }

  /**
   * Place an order.
   * @param {Object} params
   * @param {string} params.trading_symbol  — e.g. 'RELIANCE'
   * @param {string} params.exchange        — 'NSE' | 'BSE'
   * @param {string} params.segment         — 'CASH' | 'FNO'
   * @param {string} params.transaction_type — 'BUY' | 'SELL'
   * @param {number} params.quantity
   * @param {string} params.order_type      — 'MARKET' | 'LIMIT' | 'SL' | 'SL-M'
   * @param {string} params.product         — 'CNC' | 'INTRADAY' | 'MARGIN'
   * @param {number} params.price           — 0 for MARKET
   * @param {number} params.trigger_price   — for SL orders
   * @param {string} params.validity        — 'DAY' | 'IOC'
   * @param {string} params.order_reference_id — unique client ref
   * @returns {Promise<{orderId: string, status: string}>}
   */
  async placeOrder(params) { throw new Error(`${this.name}: placeOrder() not implemented`); }

  /**
   * Cancel a pending order.
   * @param {string} orderId
   * @param {string} segment — 'CASH' | 'FNO'
   */
  async cancelOrder(orderId, segment) { throw new Error(`${this.name}: cancelOrder() not implemented`); }

  /** Get all holdings (long-term / CNC positions). Returns array of holdings. */
  async getHoldings() { throw new Error(`${this.name}: getHoldings() not implemented`); }

  /** Get open intraday positions. Returns array of positions. */
  async getPositions() { throw new Error(`${this.name}: getPositions() not implemented`); }

  /** Get available funds and margin. Returns { available, used, total } */
  async getFunds() { throw new Error(`${this.name}: getFunds() not implemented`); }

  /** Get order book (list of all orders today). */
  async getOrderList() { throw new Error(`${this.name}: getOrderList() not implemented`); }

  /** Get detail of a single order. */
  async getOrderDetail(orderId, segment) { throw new Error(`${this.name}: getOrderDetail() not implemented`); }

  /** Search for tradable instruments. Optional — brokers may not support. */
  async searchStocks(query) { return { message: `${this.name}: searchStocks() not implemented`, query }; }

  /** Get option chain for a symbol. Optional — some brokers expose this. */
  async getOptionChain(symbol, expiryDate, exchange) { return { message: `${this.name}: getOptionChain() not implemented` }; }
}
