/**
 * TRADING LAUNCHER — Opens all terminal views in split panes
 * Usage: node launch.mjs [STOCK1] [STOCK2] [STOCK3]
 *        node launch.mjs TECHM WIPRO BEL NTPC
 *
 * Opens Windows Terminal with:
 *   Pane 1 (left)  : Portfolio live view
 *   Pane 2 (top-right)   : NIFTY / Stock 1
 *   Pane 3 (mid-right)   : Stock 2
 *   Pane 4 (bot-right)   : Stock 3
 */
import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const args    = process.argv.slice(2);
const stocks  = args.length > 0 ? args.map(s=>s.toUpperCase()) : ['TECHM','WIPRO','BEL','NTPC'];
const cache   = existsSync('./cache.json') ? JSON.parse(readFileSync('./cache.json','utf8')) : {};
const cwd     = process.cwd().replace(/\\/g, '/');

// Check if Windows Terminal is available
let hasWT = false;
try { execSync('where wt', { stdio:'ignore' }); hasWT = true; } catch(e) {}

// Check if portfolio-view and stock-view exist
const pvExists = existsSync('./portfolio-view.mjs');
const svExists = existsSync('./stock-view.mjs');

console.log('\n🚀 AI TRADING LAUNCHER');
console.log('─────────────────────────────');
console.log(`Stocks to watch: ${stocks.join(', ')}`);
console.log(`Windows Terminal: ${hasWT ? '✓ Available' : '✗ Using CMD fallback'}`);
console.log('');

// Show cached levels for each stock
stocks.forEach(sym => {
  const c = cache.stocks?.[sym];
  if (c) {
    console.log(`${sym}: Entry ₹${c.levels.entry}  SL ₹${c.levels.sl}  T1 ₹${c.levels.t1}  Score:${c.score}/10`);
  } else {
    console.log(`${sym}: not in cache — run npm run cache first`);
  }
});

console.log('\nLaunching terminals in 2s...\n');
await new Promise(r => setTimeout(r, 2000));

if (hasWT) {
  // Build Windows Terminal command with split panes
  // Layout: portfolio on left (40%), stocks on right stacked
  const wtArgs = [
    // Tab 1: Portfolio
    `new-tab`,
    `--title`, `"📊 PORTFOLIO"`,
    `--colorScheme`, `"One Half Dark"`,
    `cmd`, `/k`, `"cd /d "${process.cwd()}" && node portfolio-view.mjs"`,

    // Split: NIFTY view (top right)
    `;`, `split-pane`,
    `--title`, `"⚡ NIFTY"`,
    `-H`, // horizontal split
    `--size`, `0.6`,
    `cmd`, `/k`, `"cd /d "${process.cwd()}" && node stock-view.mjs NIFTY_INDEX"`,
  ];

  // Add stock panes
  stocks.slice(0, 3).forEach((sym, i) => {
    const c       = cache.stocks?.[sym];
    const entry   = c?.levels?.entry || '';
    const sl      = c?.levels?.sl    || '';
    const t1      = c?.levels?.t1    || '';
    const t2      = c?.levels?.t2    || '';
    wtArgs.push(
      `;`, `split-pane`,
      `--title`, `"${sym}"`,
      `-H`,
      `cmd`, `/k`, `"cd /d "${process.cwd()}" && node stock-view.mjs ${sym} ${entry} ${sl} ${t1} ${t2}"`
    );
  });

  try {
    spawn('wt', wtArgs, { shell: true, detached: true, stdio: 'ignore' }).unref();
    console.log('✅ Windows Terminal launched with split panes!');
    console.log('\nLayout:');
    console.log('  LEFT  → Portfolio + P&L live');
    console.log(`  RIGHT → ${['NIFTY', ...stocks.slice(0,3)].join(' | ')}`);
  } catch(e) {
    console.log('WT error:', e.message);
    fallback();
  }

} else {
  fallback();
}

function fallback() {
  console.log('Opening separate CMD windows...\n');

  // Portfolio window
  spawn('cmd', ['/c', `start "PORTFOLIO" cmd /k "cd /d "${process.cwd()}" && node portfolio-view.mjs"`],
    { shell: true, detached: true, stdio: 'ignore' }).unref();
  console.log('✓ Portfolio window opened');

  // Stock windows
  stocks.slice(0, 4).forEach((sym, i) => {
    const c     = cache.stocks?.[sym];
    const entry = c?.levels?.entry || '';
    const sl    = c?.levels?.sl    || '';
    const t1    = c?.levels?.t1    || '';
    const t2    = c?.levels?.t2    || '';
    setTimeout(() => {
      spawn('cmd', ['/c', `start "${sym}" cmd /k "cd /d "${process.cwd()}" && node stock-view.mjs ${sym} ${entry} ${sl} ${t1} ${t2}"`],
        { shell: true, detached: true, stdio: 'ignore' }).unref();
      console.log(`✓ ${sym} window opened`);
    }, (i + 1) * 500);
  });

  console.log('\n✅ All windows launching!');
  console.log('\nTip: Install Windows Terminal from Microsoft Store for split-pane view');
  console.log('     Then run: node launch.mjs again for automatic tiling');
}

console.log('\n📋 Manual commands if needed:');
console.log(`  node portfolio-view.mjs`);
stocks.forEach(sym => {
  const c = cache.stocks?.[sym];
  console.log(`  node stock-view.mjs ${sym} ${c?.levels?.entry||''} ${c?.levels?.sl||''} ${c?.levels?.t1||''}`);
});
