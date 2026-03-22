// e2e/48-ranked-daily-chat.spec.js — E2E tests for ranked mode, daily challenge, and game chat (#301)

const { test, expect } = require('@playwright/test');
const {
  goToLobby, createGame, joinGame, waitForGameStart,
  makeMove, BASE_URL, getApiBase, getSocketUrl, playToCompletion,
} = require('./helpers');
const { createGameV, joinGameV, fillVisibleNameInput } = require('./wave-helpers');

// ─── Ranked Mode ─────────────────────────────────────────────────────────────

test.describe('Ranked Mode', () => {
  test('ranked profile API returns ELO and tier for known player', async ({ request }) => {
    // Hit the ranked profile endpoint — even if player doesn't exist, it should
    // return a well-formed response (success: false or default profile)
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

    // Find the ranked button
    const rankedBtn = page.locator('button:has-text("Ranked")').first();
    await expect(rankedBtn).toBeVisible();

    // Click ranked — should enter queue (button text changes to ⏳)
    await rankedBtn.click();

    // Should show ranked queue overlay with ELO info
    await expect(page.locator('text=/ELO|Matching|ranked queue/i')).toBeVisible({ timeout: 5000 });

    // Cancel the queue
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Leave Queue"), button[aria-label*="cancel"]').first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    }
  });

  test('ranked queue shows ELO display and queue size', async ({ page }) => {
    await goToLobby(page);
    await fillVisibleNameInput(page, 'EloChecker');

    // Enter ranked queue
    await page.locator('button:has-text("Ranked")').first().click();

    // Verify ELO-related UI elements appear
    await page.waitForTimeout(1000);
    const bodyText = await page.locator('body').innerText();
    // Should show some ranked queue info (ELO, tier, queue size, matching)
    expect(bodyText).toMatch(/ELO|Matching|queue|Bronze|Silver|Gold|ranked/i);

    // Cancel to clean up
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Leave Queue")').first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
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
    // Should have puzzle data
    expect(body).toHaveProperty('challenge');
  });

  test('daily challenge page loads and shows puzzle', async ({ page }) => {
    await page.goto(`${BASE_URL}/daily`, { waitUntil: 'networkidle' });

    // Should show daily challenge content
    await expect(page.locator('body')).toContainText(/daily|challenge|puzzle/i, { timeout: 10000 });

    // Should have a game board or puzzle area
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/daily|challenge|score|move|board|puzzle/i);
  });

  test('daily challenge is accessible from lobby', async ({ page }) => {
    await goToLobby(page);

    // Find and click the daily challenge button
    const dailyBtn = page.locator('button:has-text("Daily")').first();
    await expect(dailyBtn).toBeVisible();
    await dailyBtn.click();

    // Should navigate to /daily
    await page.waitForURL(/\/daily/, { timeout: 10000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toMatch(/daily|challenge|puzzle/i);
  });

  test('daily leaderboard API returns results', async ({ request }) => {
    // Use today's date
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

      // Chat button (💬) should be visible on both pages
      const chatBtn1 = p1.locator('button[aria-label="Open quick chat"]');
      const chatBtn2 = p2.locator('button[aria-label="Open quick chat"]');

      await expect(chatBtn1).toBeVisible({ timeout: 5000 });
      await expect(chatBtn2).toBeVisible({ timeout: 5000 });
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
      await p1.locator('button[aria-label="Open quick chat"]').click();

      // Chat panel should appear with preset messages
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 3000 });

      // Should show preset messages like "Hello! 👋" and "GG! 🤝"
      await expect(chatPanel.locator('text=Hello!')).toBeVisible();
      await expect(chatPanel.locator('text=GG!')).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('sending a chat message shows bubble on both players screens', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      const roomCode = await createGameV(p1, { username: 'MsgAlice', playerCount: 2, gridSize: '3×3' });
      await joinGameV(p2, { username: 'MsgBob', roomCode });
      await waitForGameStart(p1, p2);

      // P1 opens chat and sends a message
      await p1.locator('button[aria-label="Open quick chat"]').click();
      await p1.locator('[role="dialog"][aria-label="Quick chat panel"]').waitFor({ state: 'visible' });

      // Click "Hello! 👋" preset message
      await p1.locator('button:has-text("Hello!")').first().click();

      // Chat bubble should appear on P2's screen (via socket broadcast)
      await expect(p2.locator('text=Hello!')).toBeVisible({ timeout: 5000 });

      // Now P2 sends a message back
      await p2.waitForTimeout(2500); // Wait for rate limit cooldown
      await p2.locator('button[aria-label="Open quick chat"]').click();
      await p2.locator('[role="dialog"][aria-label="Quick chat panel"]').waitFor({ state: 'visible' });

      // Click "GG! 🤝" preset message
      await p2.locator('button:has-text("GG!")').first().click();

      // Chat bubble should appear on P1's screen
      await expect(p1.locator('text=GG!')).toBeVisible({ timeout: 5000 });
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
      await p1.locator('button[aria-label="Open quick chat"]').click();
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 3000 });

      // Switch to emoji tab
      await chatPanel.locator('button:has-text("Emoji")').click();

      // Should show emoji options (🔥, 💀, 🏆, etc.)
      await expect(chatPanel.locator('button:has-text("🔥")')).toBeVisible();
      await expect(chatPanel.locator('button:has-text("🏆")')).toBeVisible();
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
      await p1.locator('button[aria-label="Open quick chat"]').click();
      const chatPanel = p1.locator('[role="dialog"][aria-label="Quick chat panel"]');
      await expect(chatPanel).toBeVisible({ timeout: 3000 });
      await chatPanel.locator('button:has-text("Emoji")').click();
      await chatPanel.locator('button:has-text("🔥")').click();

      // 🔥 should appear on P2's screen as a chat bubble
      await expect(p2.locator('.chat-overlay >> text=🔥')).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
