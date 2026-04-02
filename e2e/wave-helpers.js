// e2e/wave-helpers.js — shared helpers for Wave 1-4 E2E tests
// Uses :visible selectors to handle mobile/desktop duplicate elements in the responsive lobby.

const { goToLobby } = require('./helpers');

/** Fill the visible name input (handles mobile/desktop duplicate inputs). */
async function fillVisibleNameInput(page, username) {
  // Main lobby uses NameInput with placeholder "Enter your name…" (ellipsis)
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);
}

/** Create a CPU game using visible locators. */
async function createCpuGameV(page, { username = 'HumanPlayer', gridSize = '3×3', playerCount = 2 } = {}) {
  await goToLobby(page);
  await fillVisibleNameInput(page, username);
  await page.locator(`button:has-text("${playerCount} Players"):visible`).first().click();
  await page.locator(`button:has-text("${gridSize}"):visible`).first().click({ timeout: 3000 }).catch(() => {});

  // Ensure CPU toggle is ON (it persists in localStorage, so check first)
  const cpuAlreadyOn = await page.evaluate(() => localStorage.getItem('gridlock-cpuEnabled') === 'true');
  if (!cpuAlreadyOn) {
    await page.locator('button:has-text("Play vs CPU"):visible').first().click();
    await page.waitForTimeout(300);
  }

  await page.locator('button:has-text("🚀 Create Game"):visible').first().click();
  await page.waitForURL(/\/game/, { timeout: 15_000 });
  await page.waitForFunction(() => /turn/i.test(document.body.innerText), { timeout: 20_000 });
}

/** Create a human-only game using visible locators. Returns room code. */
async function createGameV(page, { username = 'Alice', playerCount = 2, gridSize = '3×3' } = {}) {
  await goToLobby(page);
  await fillVisibleNameInput(page, username);
  await page.locator(`button:has-text("${playerCount} Players"):visible`).first().click();
  await page.locator(`button:has-text("${gridSize}"):visible`).first().click();
  // Ensure CPU is OFF for human-only game
  const cpuOn = await page.evaluate(() => localStorage.getItem('gridlock-cpuEnabled') === 'true');
  if (cpuOn) {
    await page.locator('button:has-text("Play vs CPU"):visible').first().click();
    await page.waitForTimeout(300);
  }
  await page.locator('button:has-text("🚀 Create Game"):visible').first().click();
  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });

  const currentUrl = page.url();
  if (currentUrl.includes('/waiting/')) {
    const urlMatch = currentUrl.match(/\/waiting\/([A-Z0-9]+)/i);
    if (!urlMatch) throw new Error(`Could not extract game ID from URL: ${currentUrl}`);
    return urlMatch[1].toUpperCase().trim();
  }

  await page.waitForFunction(() => /ROOM|room code/i.test(document.body.innerText), { timeout: 15_000 });
  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/(?:ROOM|room code)[:\s\n]+([A-Z0-9]{4,8})/i)
    || bodyText.match(/Share the room code:\s*([A-Z0-9]{4,8})/i);
  if (!match) throw new Error(`Could not extract room code from: ${bodyText.slice(0, 200)}`);
  return match[1].trim();
}

/** Join a game using visible locators (handles mobile/desktop duplicate inputs). */
async function joinGameV(page, { username = 'Bob', roomCode, baseUrl, joinMode = 'player' } = {}) {
  const { BASE_URL } = require('./helpers');
  await goToLobby(page, baseUrl || BASE_URL);

  // Fill name in the profile section first (visible on desktop)
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);

  // Open the Join tab
  await page.locator('button:has-text("🔗 Join Game"):visible').first().click();
  await page.waitForTimeout(300);

  // Fill game ID and select mode
  await page.fill('input[placeholder*="e.g"]', roomCode);
  if (joinMode === 'spectator') {
    await page.click('button:has-text("Join as Spectator")');
  } else {
    await page.click('button:has-text("Join as Player")');
  }
  if (joinMode === 'spectator') {
    await page.getByRole('button', { name: /Spectate Game/i }).click();
  } else {
    await page.getByRole('button', { name: /Join Game/i }).last().click();
  }
  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });
}

/** Join a game using visible locators — waits for /waiting/ not /game (for use in waiting room tests). */
async function joinToWaitingRoom(page, { username = 'Bob', roomCode, baseUrl } = {}) {
  const { BASE_URL } = require('./helpers');
  await goToLobby(page, baseUrl || BASE_URL);

  // Fill name in the profile section first
  await page.locator('input[placeholder="Enter your name…"]:visible').first().fill(username);

  // Open Join tab, fill game ID, submit
  await page.locator('button:has-text("🔗 Join Game"):visible').first().click();
  await page.waitForTimeout(300);
  await page.fill('input[placeholder*="e.g"]', roomCode);
  await page.click('button:has-text("Join as Player")');
  await page.getByRole('button', { name: /Join Game/i }).last().click();
  // Wait for either /waiting/ or /game (game may have already started)
  await page.waitForURL(/\/(game|waiting)/, { timeout: 15_000 });
}

module.exports = { fillVisibleNameInput, createCpuGameV, createGameV, joinGameV, joinToWaitingRoom };
