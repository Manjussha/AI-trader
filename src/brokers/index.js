/**
 * Broker Factory — loads the right broker based on BROKER env var
 *
 * Supported: groww | angelone | zerodha | upstox
 *
 * Usage in your code:
 *   import { createBroker } from './brokers/index.js';
 *   const broker = createBroker();
 *   await broker.authenticate();
 *   await broker.placeOrder({ ... });
 */
import dotenv from 'dotenv';
dotenv.config();

export function createBroker() {
  const name = (process.env.BROKER || 'groww').toLowerCase();

  switch (name) {

    case 'groww': {
      const { GrowwBroker } = await_import('./groww.js');
      return new GrowwBroker({
        apiKey:     process.env.GROWW_API_KEY,
        apiSecret:  process.env.GROWW_API_SECRET,
        totpSecret: process.env.TOTP_SECRET,
      });
    }

    case 'angelone': {
      const { AngelOneBroker } = await_import('./angelone.js');
      return new AngelOneBroker({
        apiKey:     process.env.ANGELONE_API_KEY,
        clientId:   process.env.ANGELONE_CLIENT_ID,
        password:   process.env.ANGELONE_PASSWORD,
        totpSecret: process.env.ANGELONE_TOTP_SECRET,
      });
    }

    case 'zerodha': {
      const { ZerodhaBroker } = await_import('./zerodha.js');
      return new ZerodhaBroker({
        apiKey:       process.env.ZERODHA_API_KEY,
        apiSecret:    process.env.ZERODHA_API_SECRET,
        requestToken: process.env.ZERODHA_REQUEST_TOKEN,
        accessToken:  process.env.ZERODHA_ACCESS_TOKEN,
      });
    }

    case 'upstox': {
      const { UpstoxBroker } = await_import('./upstox.js');
      return new UpstoxBroker({
        apiKey:      process.env.UPSTOX_API_KEY,
        apiSecret:   process.env.UPSTOX_API_SECRET,
        code:        process.env.UPSTOX_CODE,
        redirectUri: process.env.UPSTOX_REDIRECT_URI,
        accessToken: process.env.UPSTOX_ACCESS_TOKEN,
      });
    }

    default:
      throw new Error(`Unknown broker: "${name}". Supported: groww, angelone, zerodha, upstox`);
  }
}

// Sync wrapper for ESM top-level use
// Because dynamic imports must be awaited, we use a sync factory
// that defers the import. Call initBroker() at startup instead.
export async function initBroker() {
  const name = (process.env.BROKER || 'groww').toLowerCase();

  const brokerMap = {
    groww:    async () => { const { GrowwBroker }    = await import('./groww.js');    return new GrowwBroker({ apiKey: process.env.GROWW_API_KEY, apiSecret: process.env.GROWW_API_SECRET, totpSecret: process.env.TOTP_SECRET }); },
    angelone: async () => { const { AngelOneBroker } = await import('./angelone.js'); return new AngelOneBroker({ apiKey: process.env.ANGELONE_API_KEY, clientId: process.env.ANGELONE_CLIENT_ID, password: process.env.ANGELONE_PASSWORD, totpSecret: process.env.ANGELONE_TOTP_SECRET }); },
    zerodha:  async () => { const { ZerodhaBroker }  = await import('./zerodha.js');  return new ZerodhaBroker({ apiKey: process.env.ZERODHA_API_KEY, apiSecret: process.env.ZERODHA_API_SECRET, requestToken: process.env.ZERODHA_REQUEST_TOKEN, accessToken: process.env.ZERODHA_ACCESS_TOKEN }); },
    upstox:   async () => { const { UpstoxBroker }   = await import('./upstox.js');   return new UpstoxBroker({ apiKey: process.env.UPSTOX_API_KEY, apiSecret: process.env.UPSTOX_API_SECRET, code: process.env.UPSTOX_CODE, redirectUri: process.env.UPSTOX_REDIRECT_URI, accessToken: process.env.UPSTOX_ACCESS_TOKEN }); },
  };

  const factory = brokerMap[name];
  if (!factory) throw new Error(`Unknown broker: "${name}". Set BROKER= in .env. Options: ${Object.keys(brokerMap).join(', ')}`);

  return factory();
}
