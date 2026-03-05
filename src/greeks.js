/**
 * Options Greeks Calculator — Black-Scholes Model
 * Delta, Gamma, Theta, Vega, Rho + IV estimation
 * Used by every options trader and prop desk
 */

// Cumulative Normal Distribution
function cnd(x) {
  const a1 =  0.31938153, a2 = -0.356563782, a3 =  1.781477937;
  const a4 = -1.821255978, a5 = 0.319417, k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  const pdf  = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  return x >= 0 ? 1 - pdf * poly : pdf * poly;
}

// Standard normal PDF
function npdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes Greeks
 * @param {number} S - Current stock price
 * @param {number} K - Strike price
 * @param {number} T - Time to expiry in years (e.g. 7/365)
 * @param {number} r - Risk-free rate (e.g. 0.065 for 6.5%)
 * @param {number} sigma - Implied volatility (e.g. 0.20 for 20%)
 * @param {'CE'|'PE'} type - Call or Put
 */
export function blackScholes(S, K, T, r, sigma, type = 'CE') {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const intrinsic = type === 'CE'
      ? Math.max(0, S - K)
      : Math.max(0, K - S);
    return {
      premium: intrinsic.toFixed(2),
      delta: type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0, theta: 0, vega: 0, rho: 0,
      intrinsic: intrinsic.toFixed(2), timeValue: '0.00',
    };
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let premium, delta;
  if (type === 'CE') {
    premium = S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2);
    delta   = cnd(d1);
  } else {
    premium = K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);
    delta   = cnd(d1) - 1;
  }

  const gamma  = npdf(d1) / (S * sigma * Math.sqrt(T));
  const vega   = S * npdf(d1) * Math.sqrt(T) / 100;        // per 1% IV change
  const theta  = type === 'CE'
    ? (-(S * npdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * cnd(d2)) / 365
    : (-(S * npdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * cnd(-d2)) / 365;
  const rho    = type === 'CE'
    ?  K * T * Math.exp(-r * T) * cnd(d2) / 100
    : -K * T * Math.exp(-r * T) * cnd(-d2) / 100;

  const intrinsic  = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
  const timeValue  = premium - intrinsic;

  return {
    premium:   premium.toFixed(2),
    intrinsic: intrinsic.toFixed(2),
    timeValue: Math.max(0, timeValue).toFixed(2),
    delta:     delta.toFixed(4),
    gamma:     gamma.toFixed(6),
    theta:     theta.toFixed(4),   // daily P&L decay
    vega:      vega.toFixed(4),
    rho:       rho.toFixed(4),
    d1:        d1.toFixed(4),
    d2:        d2.toFixed(4),
    moneyness: S > K * 1.01 ? (type === 'CE' ? 'ITM' : 'OTM')
             : S < K * 0.99 ? (type === 'CE' ? 'OTM' : 'ITM')
             : 'ATM',
  };
}

/**
 * Estimate Implied Volatility via Newton-Raphson bisection
 * @param {number} marketPremium - Observed market premium
 */
export function impliedVolatility(S, K, T, r, marketPremium, type = 'CE') {
  if (T <= 0) return null;
  let lo = 0.01, hi = 5.0;
  for (let i = 0; i < 100; i++) {
    const mid     = (lo + hi) / 2;
    const calcPrem = parseFloat(blackScholes(S, K, T, r, mid, type).premium);
    if (Math.abs(calcPrem - marketPremium) < 0.01) return mid;
    if (calcPrem < marketPremium) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Build option chain Greeks for a set of strikes
 * @param {number} spot - Current spot price
 * @param {number[]} strikes - Array of strike prices
 * @param {number} daysToExpiry - Days left to expiry
 * @param {number} iv - Implied volatility (e.g. 0.15 for 15%)
 */
export function buildChainGreeks(spot, strikes, daysToExpiry, iv = 0.15) {
  const T = daysToExpiry / 365;
  const r = 0.065; // RBI repo rate approximation
  return strikes.map(K => {
    const ce = blackScholes(spot, K, T, r, iv, 'CE');
    const pe = blackScholes(spot, K, T, r, iv, 'PE');
    return {
      strike:    K,
      CE_premium: ce.premium,
      CE_delta:   ce.delta,
      CE_theta:   ce.theta,
      CE_moneyness: ce.moneyness,
      PE_premium: pe.premium,
      PE_delta:   pe.delta,
      PE_theta:   pe.theta,
      PE_moneyness: pe.moneyness,
      gamma:      ce.gamma,
      vega:       ce.vega,
    };
  });
}

/**
 * Max Pain — strike where option sellers lose the least
 * @param {Object[]} chain - Array of { strike, CE_OI, PE_OI }
 */
export function maxPain(chain) {
  let minLoss = Infinity, mpStrike = null;
  for (const target of chain) {
    let totalLoss = 0;
    for (const c of chain) {
      const ceLoss = Math.max(0, c.strike - target.strike) * (c.CE_OI || 0);
      const peLoss = Math.max(0, target.strike - c.strike) * (c.PE_OI || 0);
      totalLoss += ceLoss + peLoss;
    }
    if (totalLoss < minLoss) { minLoss = totalLoss; mpStrike = target.strike; }
  }
  return mpStrike;
}
