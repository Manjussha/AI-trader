/**
 * TOTP Generator + Groww Auto-Auth
 * Generates 6-digit TOTP codes from your TOTP secret
 * and attempts to exchange auth-totp token for a full session token
 */
import { createHmac } from 'crypto';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

function base32Decode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0;
  const output = [];
  for (const c of str) {
    val = (val << 5) | chars.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; output.push((val >>> bits) & 0xff); }
  }
  return Buffer.from(output);
}

export function generateTOTP(secret = process.env.TOTP_SECRET) {
  if (!secret) throw new Error('TOTP_SECRET not set in .env');
  const key = base32Decode(secret.trim());
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
  const totp = String(code % 1000000).padStart(6, '0');
  const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  return { totp, secsLeft };
}

export async function verifyTOTP(authTotpToken, totpCode) {
  const headers = {
    'Authorization': `Bearer ${authTotpToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Origin': 'https://groww.in',
    'Referer': 'https://groww.in/'
  };

  // Known Groww TOTP verification endpoints to try
  const endpoints = [
    { url: 'https://api.groww.in/v1/totp/verify',        body: { totp: totpCode } },
    { url: 'https://api.groww.in/v1/user/totp/verify',   body: { totp: totpCode } },
    { url: 'https://api.groww.in/v1/auth/totp',          body: { totp: totpCode } },
    { url: 'https://api.groww.in/v1/login/totp/verify',  body: { totpCode } },
    { url: 'https://groww.in/v1/api/login/totp/verify',  body: { totp: totpCode } },
  ];

  for (const { url, body } of endpoints) {
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await r.json();
      if (r.ok || (data?.success?.data?.token || data?.token || data?.accessToken)) {
        const token = data?.success?.data?.token || data?.token || data?.accessToken;
        if (token) return { success: true, token, url };
        if (r.ok) return { success: true, data, url };
      }
    } catch {}
  }
  return { success: false, message: 'TOTP verification endpoint not found. Complete auth via Groww website.' };
}

// CLI usage
if (process.argv[1].endsWith('totp.js')) {
  const secret = process.env.TOTP_SECRET;
  if (!secret) {
    console.error('Set TOTP_SECRET in your .env file');
    process.exit(1);
  }
  const { totp, secsLeft } = generateTOTP(secret);
  console.log(`Current TOTP: ${totp} (valid for ${secsLeft}s)`);
}
