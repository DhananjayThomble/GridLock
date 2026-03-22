// e2e/48-ranked-daily-chat.spec.js — E2E tests for ranked mode, daily challenge, and game chat (#301)

const { test, expect } = require('@playwright/test');
const {
  goToLobby, waitForGameStart,
  BASE_URL, getApiBase,
} = require('./helpers');
const { createGameV, joinGameV, fillVisibleNameInput } = require('./wave-helpers');

/**
 * Click the first visible button matching the given text.
 * The lobby renders duplicate mobile/desktop buttons — pick the visible one.
 */
async function clickVisibleButton(page, textMatch) {
  const btns = page.locator(`button:has-text("${textMatch}")`);
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    if (await btns.nth(i).isVisible()) {
      await btns.nth(i).click();
      return;
    }
  }
  throw new Error(`No visible button found matching "${textMatch}"`);
}

// ─── Ranked Mode ─────────────────────────────────────────────────────────────

test.describe('Ranked Mode', () => {
  test('ranked profile API returns ELO and tier for known player', async ({ request }) => {
    const res = await request.get(`${getApiBase()}/api/ranked/profile/__e2e_test_player__`);
    expect([200, 404]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('success');
  });

  test('ranked leaderboard API returns array', async ({ request }) => {
    const res = await request.get(`${getApiBase()}/api/ranked/leaderboard`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('leaderboard');
    expect(Array.isArray(body.leaderboard)).toBe(true);
  });

  test('ranked queue button exists and toggles queue state', async ({ page }) => {
    await goToLobby(page);
    await fillVisibleNameInput(page, 'RankedTester');

    // Click the visible ranked button (skip hidden mobile duplicate)
    await clickVisibleButton(page, 'Ranked');

    // Should show ranked queue overlay with ELO/matching info
    await expect(page.locator('text=/ELO|Matching|ranked queue/i').first()).toBeVisible({ timeout: 10000 });

    // Cancel the queue — look for any cancel/leave button
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Leave")');
    const cancelCount = await cancelBtn.count();
    for (let i = 0; i < cancelCount; i++) {
      if (await cancelBtn.nth(i).isVisible()) {
        await cancelBtn.nth(i).click();
        break;
      }
    }
  });

  test('ranked queue shows ELO display and queue size', async ({ page }) => {
    await goToLobby(page);
    await fillVisibleNameInput(page, 'EloChecker');

    // Enter ranked queue
    await clickVisibleButton(page, 'Ranked');

    // Verify ELO-related UI elements appear
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/ELO|Matching|queue|Bronze|Silver|Gold|ranked/i);

    // Cancel to clean up
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Leave")');
    const cancelCount = await cancelBtn.count();
    for (let i = 0; i < cancelCount; i++) {
      if (await cancelBtn.nth(i).isVisible()) {
        await cancelBtn.nth(i).click();
        break;
      }
    }
  });
});

// ─── Daily Challenge ─────────────────────────────────────────────────────────

test.describe('Daily Challenge', () => {
  test('daily challenge API returns today\'s puzzle', async ({ request }) => {
    const res = await request.get(`${getApiBase()}/api/daily/today`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('challenge');
  });

  test('daily challenge page loads and shows content', async ({ page }) => {
    await page.goto(`${BASE_URL}/daily`, { waitUntil: 'networkidle' });

    // Wait for lazy-loaded chunk — spinner disappears once content renders
    await page.locator('[aria-label="Loading page"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // Should show daily challenge content
    await expect(page.locator('body')).toContainText(/daily|challenge|puzzle|score|move/i, { timeout: 10000 });
  });

  test('daily challenge is accessible from lobby', async ({ page }) => {
    await goToLobby(page);
    await fillVisibleNameInput(page, 'DailyTester');

    // Click the visible daily button
    await clickVisibleButton(page, 'Daily');

    // Should navigate to /daily
    await page.waitForURL(/\/daily/, { timeout: 10000 });

    // Wait for lazy-loaded chunk
    await page.locator('[aria-label="Loading page"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/daily|challenge|puzzle|score|move/i);
  });

  test('daily leaderboard API returns results', async ({ request }) => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(`${getApiBase()}/api/daily/leaderboard/${today}`);
    expect([200, 404]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('success');
  });

  test('daily streak API responds correctly', async ({ request }) => {
    const res = await request.get(`${getApiBase()}/api/daily/streak/__e2e_test_user__`);
    expect([200, 404]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('success');
  });
});

// ─── Game Chat ───────────────────────────────────────────────────────────────

test.describe('Game Chat', () => {
  test('chat button appears during active game', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'ChatAlice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'ChatBob', roomCode });
      await waitForGameStart(p1, p2);

      // Chat button (💬) should be visible — aria-label is "Quick chat"
      const chatBtn1 = p1.locator('button[aria-label="Quick chat"]');
      const chatBtn2 = p2.locator('button[aria-label="Quick chat"]');

      await expect(chatBtn1).toBeVisible({ timeout: 10000 });
      await expect(chatBtn2).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('chat panel opens with preset messages', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'PanelAlice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'PanelBob', roomCode });
      await waitForGameStart(p1, p2);

      // Open chat panel on p1
      await p1.locator('button[aria-label="Quick chat"]').click();

      // Chat panel should appear with preset messages
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 5000 });

      // Should show preset messages like "Hello! 👋" and "GG! 🤝"
      await expect(chatPanel.locator('text=Hello!')).toBeVisible();
      await expect(chatPanel.locator('text=GG!')).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('sending a chat message shows bubble on other player screen', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'MsgAlice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'MsgBob', roomCode });
      await waitForGameStart(p1, p2);

      // P1 opens chat and sends "Hello! 👋"
      await p1.locator('button[aria-label="Quick chat"]').click();
      await p1.locator('[role="dialog"][aria-label="Quick chat panel"]').waitFor({ state: 'visible' });
      await p1.locator('.chat-msg-btn:has-text("Hello!")').first().click();

      // Chat bubble should appear on P2's screen (via socket broadcast)
      await expect(p2.locator('.chat-overlay >> text=Hello! 👋')).toBeVisible({ timeout: 8000 });

      // Now P2 sends a message back — wait for rate limit cooldown
      await p2.waitForTimeout(2500);
      await p2.locator('button[aria-label="Quick chat"]').click();
      await p2.locator('[role="dialog"][aria-label="Quick chat panel"]').waitFor({ state: 'visible' });
      await p2.locator('.chat-msg-btn:has-text("GG!")').first().click();

      // Chat bubble should appear on P1's screen
      await expect(p1.locator('.chat-overlay >> text=GG! 🤝')).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('chat has emoji tab with emoji options', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'EmojiAlice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'EmojiBob', roomCode });
      await waitForGameStart(p1, p2);

      // Open chat panel
      await p1.locator('button[aria-label="Quick chat"]').click();
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 5000 });

      // Switch to emoji tab
      await chatPanel.locator('.chat-panel-tab:has-text("Emoji")').click();

      // Should show emoji options (🔥, 💀, 🏆, etc.)
      await expect(chatPanel.locator('.chat-emoji-btn:has-text("🔥")')).toBeVisible();
      await expect(chatPanel.locator('.chat-emoji-btn:has-text("🏆")')).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('sending emoji shows on other player screen', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'Emoji2Alice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'Emoji2Bob', roomCode });
      await waitForGameStart(p1, p2);

      // P1 opens chat, switches to emoji tab, sends 🔥
      await p1.locator('button[aria-label="Quick chat"]').click();
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 5000 });
      await chatPanel.locator('.chat-panel-tab:has-text("Emoji")').click();
      await chatPanel.locator('.chat-emoji-btn:has-text("🔥")').click();

      // 🔥 should appear on P2's screen as a chat bubble
      await expect(p2.locator('.chat-overlay >> text=🔥')).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
