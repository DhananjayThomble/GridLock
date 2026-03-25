const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://beta.gridlock.pro';
const API_URL = 'https://beta-api.gridlock.pro';
const dateStr = new Date().toISOString().split("T")[0];
const OUT_DIR = path.join(__dirname, `mobile-audit-${dateStr}`);

const DEVICES = [
  { name: 'iphone-14', width: 390, height: 844, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', dpr: 3 },
  { name: 'galaxy-s22', width: 360, height: 780, ua: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', dpr: 3 },
  { name: 'pixel-7', width: 412, height: 915, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', dpr: 2.625 },
];

let totalCaptured = 0;
let failures = [];

async function cap(page, dir, name, opts = {}) {
  const fp = path.join(dir, `${name}.png`);
  try {
    await page.screenshot({ path: fp, fullPage: !!opts.fullPage, timeout: 10000 });
    totalCaptured++;
    console.log(`  ✅ ${name}.png`);
  } catch (e) {
    failures.push(`${path.basename(dir)}/${name}: ${e.message.slice(0, 80)}`);
    console.log(`  ❌ ${name}.png — ${e.message.slice(0, 80)}`);
  }
}

async function waitApp(page) {
  try { await page.waitForSelector('#app', { timeout: 8000 }); } catch (_) {}
  await page.waitForTimeout(1500);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('gridlock_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(400);
}

// Force-click helper — uses JS click to bypass pointer interception
async function forceClick(page, selector, timeout = 5000) {
  try {
    const el = await page.waitForSelector(selector, { timeout });
    await el.evaluate(e => e.click());
    return true;
  } catch (_) {
    return false;
  }
}

// Try multiple selectors, return first match
async function tryClick(page, selectors, timeout = 3000) {
  for (const sel of selectors) {
    if (await forceClick(page, sel, timeout)) return true;
  }
  return false;
}

async function captureLobby(page, dir) {
  console.log('  📍 Lobby');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await waitApp(page);

  // Dark
  await setTheme(page, 'dark');
  await cap(page, dir, 'lobby-default-dark', { fullPage: true });
  await cap(page, dir, 'lobby-default-dark-viewport');

  // Light
  await setTheme(page, 'light');
  await cap(page, dir, 'lobby-default-light', { fullPage: true });
  await cap(page, dir, 'lobby-default-light-viewport');

  await setTheme(page, 'dark');

  // Name input
  try {
    const nameInput = await page.$('input[placeholder*="name" i], input[placeholder*="Name" i], input[type="text"]');
    if (nameInput) {
      await nameInput.fill('QA_Tester');
      await page.waitForTimeout(300);
      await cap(page, dir, 'lobby-name-entered');
    }
  } catch (e) { console.log(`  ⚠️ name input: ${e.message.slice(0,60)}`); }

  // Avatar picker — use aria label
  try {
    const clicked = await forceClick(page, 'button[aria-label*="profile" i], button[aria-label*="avatar" i], [aria-controls="mobile-profile-panel"]');
    if (clicked) {
      await page.waitForTimeout(600);
      await cap(page, dir, 'lobby-avatar-picker');
      // Close panel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      // If escape didn't work, click elsewhere
      await page.mouse.click(10, 10);
      await page.waitForTimeout(300);
    }
  } catch (e) { console.log(`  ⚠️ avatar picker: ${e.message.slice(0,60)}`); }

  // Player count: 2P, 3P, 4P — use text matching via evaluate
  for (const count of ['2', '3', '4']) {
    try {
      const clicked = await page.evaluate((c) => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => b.textContent.trim() === `${c}P` || b.textContent.trim() === c);
        if (btn) { btn.click(); return true; }
        return false;
      }, count);
      if (clicked) {
        await page.waitForTimeout(400);
        await cap(page, dir, `lobby-${count}p-selected`);
      }
    } catch (e) { console.log(`  ⚠️ ${count}P: ${e.message.slice(0,60)}`); }
  }

  // Grid sizes
  for (const size of [3, 4, 5, 6]) {
    try {
      const clicked = await page.evaluate((s) => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => {
          const t = b.textContent.trim();
          return t === `${s}×${s}` || t === `${s}x${s}` || t === `${s}`;
        });
        if (btn) { btn.click(); return true; }
        return false;
      }, size);
      if (clicked) {
        await page.waitForTimeout(400);
        await cap(page, dir, `lobby-grid-${size}x${size}`);
      }
    } catch (e) { console.log(`  ⚠️ grid ${size}: ${e.message.slice(0,60)}`); }
  }

  // CPU toggle
  try {
    const toggled = await page.evaluate(() => {
      // Look for checkbox/toggle near CPU text
      const labels = [...document.querySelectorAll('label, span, div')];
      for (const l of labels) {
        if (/cpu|computer|bot/i.test(l.textContent)) {
          const toggle = l.querySelector('input, [role="switch"]') || l.closest('label')?.querySelector('input') || l.parentElement?.querySelector('input, [role="switch"]');
          if (toggle) { toggle.click(); return true; }
          // Maybe the label itself is clickable
          l.click(); return true;
        }
      }
      return false;
    });
    if (toggled) {
      await page.waitForTimeout(500);
      await cap(page, dir, 'lobby-cpu-toggle-on');
      // Check for difficulty dropdown
      await page.waitForTimeout(300);
      await cap(page, dir, 'lobby-cpu-difficulty-options');
    }
  } catch (e) { console.log(`  ⚠️ CPU toggle: ${e.message.slice(0,60)}`); }

  // Join tab
  try {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="tab"]')];
      const btn = btns.find(b => /^join$/i.test(b.textContent.trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(500);
      await cap(page, dir, 'lobby-join-tab');

      const codeInput = await page.$('input[placeholder*="code" i], input[placeholder*="Code" i], input[maxlength]');
      if (codeInput) {
        await codeInput.fill('ABCD12');
        await page.waitForTimeout(300);
        await cap(page, dir, 'lobby-join-code-entered');
      }
    }
  } catch (e) { console.log(`  ⚠️ join tab: ${e.message.slice(0,60)}`); }

  // Back to Create tab
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="tab"]')];
    const btn = btns.find(b => /^create$/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);

  // Tournament tab
  try {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="tab"]')];
      const btn = btns.find(b => /tournament/i.test(b.textContent.trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(500);
      await cap(page, dir, 'lobby-tournament-tab');
    }
  } catch (e) { console.log(`  ⚠️ tournament tab: ${e.message.slice(0,60)}`); }

  // Quick Play
  try {
    const qpExists = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some(b => /quick/i.test(b.textContent));
    });
    if (qpExists) await cap(page, dir, 'lobby-quick-play-visible');
  } catch (_) {}

  // Recent opponents
  try {
    const clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, summary, [class*="recent" i]')];
      const el = els.find(e => /recent/i.test(e.textContent));
      if (el) { el.click(); return true; }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(400);
      await cap(page, dir, 'lobby-recent-opponents');
    }
  } catch (_) {}
}

async function captureStaticPages(page, dir) {
  const pages = [
    { path: '/daily', name: 'daily-challenge' },
    { path: '/leaderboard', name: 'leaderboard' },
    { path: '/how-to-play', name: 'how-to-play' },
    { path: '/settings', name: 'settings' },
    { path: '/history', name: 'history' },
  ];

  for (const p of pages) {
    console.log(`  📍 ${p.name}`);
    try {
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() =>
        page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
      );
      await waitApp(page);

      await setTheme(page, 'dark');
      await cap(page, dir, `${p.name}-dark`, { fullPage: true });
      await cap(page, dir, `${p.name}-dark-viewport`);

      await setTheme(page, 'light');
      await cap(page, dir, `${p.name}-light`, { fullPage: true });
      await cap(page, dir, `${p.name}-light-viewport`);

      if (p.name === 'leaderboard') {
        await setTheme(page, 'dark');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        await cap(page, dir, 'leaderboard-scrolled', { fullPage: true });
      }

      if (p.name === 'how-to-play') {
        await setTheme(page, 'dark');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(300);
        await cap(page, dir, 'how-to-play-mid-scroll');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        await cap(page, dir, 'how-to-play-bottom');
      }
    } catch (e) {
      console.log(`  ⚠️ ${p.name}: ${e.message.slice(0,80)}`);
      failures.push(`${path.basename(dir)}/${p.name}: ${e.message.slice(0, 80)}`);
    }
  }
}

async function captureProfile(page, dir) {
  console.log('  📍 Profile');
  try {
    await page.goto(`${BASE_URL}/profile/Player5`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() =>
      page.goto(`${BASE_URL}/profile/Player5`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    );
    await waitApp(page);
    await setTheme(page, 'dark');
    await cap(page, dir, 'profile-player-dark', { fullPage: true });
    await setTheme(page, 'light');
    await cap(page, dir, 'profile-player-light', { fullPage: true });
  } catch (e) {
    console.log(`  ⚠️ profile: ${e.message.slice(0,80)}`);
  }
}

async function captureErrorStates(page, dir) {
  console.log('  📍 Error states');

  const errorPages = [
    { url: '/profile/nonexistent_zzz999', name: 'error-profile-nonexistent' },
    { url: '/join/INVALID999', name: 'error-invalid-room' },
    { url: '/game', name: 'error-direct-game' },
    { url: '/this-does-not-exist', name: 'error-404' },
  ];

  for (const ep of errorPages) {
    try {
      await page.goto(`${BASE_URL}${ep.url}`, { waitUntil: 'networkidle', timeout: 12000 }).catch(() =>
        page.goto(`${BASE_URL}${ep.url}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
      );
      await waitApp(page);
      await setTheme(page, 'dark');
      await cap(page, dir, `${ep.name}-dark`, { fullPage: true });
      await setTheme(page, 'light');
      await cap(page, dir, `${ep.name}-light`, { fullPage: true });
    } catch (e) {
      console.log(`  ⚠️ ${ep.name}: ${e.message.slice(0,80)}`);
    }
  }
}

async function captureNavBar(page, dir) {
  console.log('  📍 Navigation bar');
  const navPages = [
    { path: '/', name: 'nav-home-active' },
    { path: '/daily', name: 'nav-daily-active' },
    { path: '/leaderboard', name: 'nav-leaderboard-active' },
    { path: '/settings', name: 'nav-settings-active' },
  ];
  for (const p of navPages) {
    try {
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'networkidle', timeout: 12000 }).catch(() =>
        page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
      );
      await waitApp(page);
      await setTheme(page, 'dark');
      const vp = page.viewportSize();
      await page.screenshot({
        path: path.join(dir, `${p.name}.png`),
        clip: { x: 0, y: vp.height - 120, width: vp.width, height: 120 },
      });
      totalCaptured++;
      console.log(`  ✅ ${p.name}.png`);
    } catch (e) {
      console.log(`  ⚠️ ${p.name}: ${e.message.slice(0,60)}`);
    }
  }
}

async function captureGameplay(page, dir) {
  // --- 2P CPU game ---
  console.log('  📍 Game board (2P CPU)');
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await waitApp(page);
    await setTheme(page, 'dark');

    // Fill name
    const nameInput = await page.$('input[type="text"]');
    if (nameInput) { await nameInput.fill('QA_2P'); await page.waitForTimeout(200); }

    // Ensure Create tab
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, [role="tab"]')].find(b => /^create$/i.test(b.textContent.trim()));
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // Select 2P
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '2P');
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // Select 3x3
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => /3[×x]3/.test(b.textContent.trim()));
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // Enable CPU
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('label, div, span')];
      for (const l of labels) {
        if (/cpu|computer|bot/i.test(l.textContent) && l.textContent.length < 30) {
          const inp = l.querySelector('input, [role="switch"]') || l.closest('label')?.querySelector('input');
          if (inp) { inp.click(); return; }
          l.click(); return;
        }
      }
    });
    await page.waitForTimeout(500);
    await cap(page, dir, 'lobby-pre-create-2p-cpu');

    // Click Create/Play
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[type="submit"], button')].find(b =>
        /^(create|play|start)\s*(game|room)?$/i.test(b.textContent.trim())
      );
      if (b) b.click();
    });
    await page.waitForTimeout(4000);

    const url = page.url();
    console.log(`    URL after create: ${url}`);

    if (url.includes('/game') || url.includes('/room') || url.includes('/play')) {
      await cap(page, dir, 'board-2p-3x3-initial', { fullPage: true });
      await cap(page, dir, 'board-2p-3x3-initial-viewport');

      // Find clickable board area
      const boardEl = await page.$('canvas, [class*="board" i], [class*="game-grid" i], [class*="dots-grid" i], svg');
      if (boardEl) {
        const box = await boardEl.boundingBox();
        if (box) {
          // Make some moves on edges between dots
          const moves = [];
          const step = box.width / 4;
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 3; c++) {
              // Horizontal edges: between dot(r,c) and dot(r,c+1)
              moves.push({ x: box.x + step * c + step * 0.5, y: box.y + step * r });
            }
            if (r < 3) {
              for (let c = 0; c < 4; c++) {
                // Vertical edges: between dot(r,c) and dot(r+1,c)
                moves.push({ x: box.x + step * c, y: box.y + step * r + step * 0.5 });
              }
            }
          }

          let movesPlayed = 0;
          for (const m of moves) {
            if (movesPlayed >= 6) break;
            await page.mouse.click(m.x, m.y);
            movesPlayed++;
            await page.waitForTimeout(1500); // Wait for CPU

            // Check for modal
            const modal = await page.$('[class*="modal" i]:visible, [class*="winner" i], [class*="game-over" i], dialog:visible');
            if (modal) break;
          }

          await cap(page, dir, 'board-2p-3x3-in-progress', { fullPage: true });
          await cap(page, dir, 'board-2p-3x3-in-progress-viewport');

          // Continue playing to try to finish
          for (const m of moves.slice(6)) {
            await page.mouse.click(m.x, m.y);
            await page.waitForTimeout(1000);
            const modal = await page.$('[class*="modal" i], [class*="winner" i], [class*="game-over" i], dialog');
            if (modal) {
              const vis = await modal.isVisible().catch(() => false);
              if (vis) {
                await page.waitForTimeout(500);
                await cap(page, dir, 'board-2p-winner-modal', { fullPage: true });
                await cap(page, dir, 'board-2p-winner-modal-viewport');
                break;
              }
            }
          }
        }
      }

      // Score bar clip
      try {
        const scoreEl = await page.$('[class*="score" i]');
        if (scoreEl) {
          const sbox = await scoreEl.boundingBox();
          if (sbox) {
            await page.screenshot({
              path: path.join(dir, 'board-2p-score-bar.png'),
              clip: { x: Math.max(0, sbox.x), y: Math.max(0, sbox.y), width: sbox.width, height: sbox.height },
            });
            totalCaptured++;
            console.log('  ✅ board-2p-score-bar.png');
          }
        }
      } catch (_) {}

      // Chat
      try {
        const chatClicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(b => /chat/i.test(b.textContent) || b.getAttribute('aria-label')?.includes('chat'));
          if (b) { b.click(); return true; }
          return false;
        });
        if (chatClicked) {
          await page.waitForTimeout(500);
          await cap(page, dir, 'board-2p-chat-open');
        }
      } catch (_) {}

    } else {
      // Waiting room
      await cap(page, dir, 'board-2p-waiting-room', { fullPage: true });
      await cap(page, dir, 'board-2p-waiting-room-viewport');
      // Capture room code
      await cap(page, dir, 'board-2p-room-code-visible');
    }
  } catch (e) {
    console.log(`  ⚠️ 2P gameplay: ${e.message.slice(0,100)}`);
    failures.push(`${path.basename(dir)}/2p-gameplay: ${e.message.slice(0,80)}`);
  }

  // --- 4P CPU game ---
  console.log('  📍 Game board (4P CPU)');
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await waitApp(page);
    await setTheme(page, 'dark');

    const ni = await page.$('input[type="text"]');
    if (ni) { await ni.fill('QA_4P'); await page.waitForTimeout(200); }

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, [role="tab"]')].find(b => /^create$/i.test(b.textContent.trim()));
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // 4P
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '4P');
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // 4x4
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => /4[×x]4/.test(b.textContent.trim()));
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // CPU
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('label, div, span')];
      for (const l of labels) {
        if (/cpu|computer|bot/i.test(l.textContent) && l.textContent.length < 30) {
          const inp = l.querySelector('input, [role="switch"]') || l.closest('label')?.querySelector('input');
          if (inp) { inp.click(); return; }
          l.click(); return;
        }
      }
    });
    await page.waitForTimeout(500);

    // Create
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[type="submit"], button')].find(b =>
        /^(create|play|start)\s*(game|room)?$/i.test(b.textContent.trim())
      );
      if (b) b.click();
    });
    await page.waitForTimeout(4000);

    const url4 = page.url();
    console.log(`    URL after 4P create: ${url4}`);

    if (url4.includes('/game') || url4.includes('/room') || url4.includes('/play')) {
      await cap(page, dir, 'board-4p-4x4-initial', { fullPage: true });
      await cap(page, dir, 'board-4p-4x4-initial-viewport');

      // Try some moves
      const boardEl = await page.$('canvas, [class*="board" i], [class*="game-grid" i], svg');
      if (boardEl) {
        const box = await boardEl.boundingBox();
        if (box) {
          for (let i = 0; i < 10; i++) {
            const rx = box.x + (Math.random() * 0.8 + 0.1) * box.width;
            const ry = box.y + (Math.random() * 0.8 + 0.1) * box.height;
            await page.mouse.click(rx, ry);
            await page.waitForTimeout(1200);
          }
          await cap(page, dir, 'board-4p-4x4-in-progress', { fullPage: true });
        }
      }
    } else {
      await cap(page, dir, 'board-4p-waiting-room', { fullPage: true });
    }
  } catch (e) {
    console.log(`  ⚠️ 4P gameplay: ${e.message.slice(0,100)}`);
    failures.push(`${path.basename(dir)}/4p-gameplay: ${e.message.slice(0,80)}`);
  }
}

async function runForDevice(browser, device) {
  console.log(`\n🔧 Device: ${device.name} (${device.width}×${device.height})`);
  const dir = path.join(OUT_DIR, device.name);
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    userAgent: device.ua,
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  await page.addInitScript(() => {
    localStorage.setItem('gridlock_theme', 'dark');
  });

  try { await captureLobby(page, dir); } catch (e) {
    console.log(`  ⚠️ lobby fatal: ${e.message.slice(0,80)}`);
    failures.push(`${device.name}/lobby: ${e.message.slice(0, 80)}`);
  }

  try { await captureStaticPages(page, dir); } catch (e) {
    console.log(`  ⚠️ static pages fatal: ${e.message.slice(0,80)}`);
    failures.push(`${device.name}/static: ${e.message.slice(0, 80)}`);
  }

  try { await captureProfile(page, dir); } catch (e) {
    console.log(`  ⚠️ profile fatal: ${e.message.slice(0,80)}`);
  }

  try { await captureErrorStates(page, dir); } catch (e) {
    console.log(`  ⚠️ error states fatal: ${e.message.slice(0,80)}`);
  }

  try { await captureNavBar(page, dir); } catch (e) {
    console.log(`  ⚠️ nav bar fatal: ${e.message.slice(0,80)}`);
  }

  try { await captureGameplay(page, dir); } catch (e) {
    console.log(`  ⚠️ gameplay fatal: ${e.message.slice(0,80)}`);
  }

  await context.close();
}

(async () => {
  console.log('🚀 GridLock Mobile Screenshot Audit v2');
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Output: ${OUT_DIR}`);
  console.log(`   Devices: ${DEVICES.map(d => `${d.name} (${d.width}×${d.height})`).join(', ')}`);
  console.log('');

  const browser = await chromium.launch({ headless: true });

  for (const device of DEVICES) {
    await runForDevice(browser, device);
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log('📊 AUDIT SUMMARY');
  console.log(`   Total screenshots captured: ${totalCaptured}`);
  console.log(`   Failures: ${failures.length}`);
  if (failures.length > 0) {
    console.log('   Failed captures:');
    failures.forEach(f => console.log(`     ❌ ${f}`));
  }

  // List all files
  console.log('\n📁 Files by device:');
  for (const d of DEVICES) {
    const ddir = path.join(OUT_DIR, d.name);
    const files = fs.readdirSync(ddir).sort();
    console.log(`   ${d.name}/ (${files.length} files)`);
    files.forEach(f => console.log(`     ${f}`));
  }

  console.log('='.repeat(60));
})();
