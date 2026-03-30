const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers');

/**
 * SEO Meta Tags + Structured Data — E2E tests (#455)
 */

const PAGE_META = [
  {
    name: 'Lobby',
    path: '/',
    titleKeywords: ['GridLock', 'Dots', 'Boxes', 'Online', 'Multiplayer'],
    descKeywords: ['dots and boxes', 'strategy', 'multiplayer'],
  },
  {
    name: 'How to Play',
    path: '/how-to-play',
    titleKeywords: ['How to Play', 'GridLock', 'Rules', 'Strategy'],
    descKeywords: ['dots and boxes', 'rules', 'strategy'],
  },
  {
    name: 'Leaderboard',
    path: '/leaderboard',
    titleKeywords: ['GridLock', 'Leaderboard', 'Top Players', 'Rankings'],
    descKeywords: ['top', 'GridLock', 'players', 'ranked'],
  },
  {
    name: 'Daily Challenge',
    path: '/daily',
    titleKeywords: ['Daily', 'GridLock', 'Challenge', 'Puzzle'],
    descKeywords: ['daily', 'challenge', 'puzzle', 'leaderboard'],
  },
  {
    name: 'Game History',
    path: '/history',
    titleKeywords: ['Game History', 'GridLock'],
    descKeywords: ['past', 'GridLock', 'games', 'replays', 'stats'],
  },
  {
    name: 'Settings',
    path: '/settings',
    titleKeywords: ['Settings', 'GridLock'],
    descKeywords: ['GridLock', 'experience', 'themes', 'sounds'],
  },
];

test.describe('SEO Meta Tags — Per-Page', () => {
  for (const pageMeta of PAGE_META) {
    test.describe(pageMeta.name, () => {
      test(`has correct document.title`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const title = await page.title();
        for (const keyword of pageMeta.titleKeywords) {
          expect(title.toLowerCase()).toContain(keyword.toLowerCase());
        }
      });

      test(`has non-empty meta description`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const desc = await page.getAttribute('meta[name="description"]', 'content');
        expect(desc).toBeTruthy();
        expect(desc.length).toBeGreaterThan(20);
        for (const keyword of pageMeta.descKeywords) {
          expect(desc.toLowerCase()).toContain(keyword.toLowerCase());
        }
      });

      test(`has og:title matching page title`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const title = await page.title();
        const ogTitle = await page.getAttribute('meta[property="og:title"]', 'content');
        expect(ogTitle).toBeTruthy();
        expect(ogTitle).toBe(title);
      });

      test(`has og:description`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const ogDesc = await page.getAttribute('meta[property="og:description"]', 'content');
        expect(ogDesc).toBeTruthy();
        expect(ogDesc.length).toBeGreaterThan(20);
      });

      test(`has og:image set`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const ogImage = await page.getAttribute('meta[property="og:image"]', 'content');
        expect(ogImage).toBeTruthy();
        expect(ogImage).toContain('og-image');
      });

      test(`has og:url set`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const ogUrl = await page.getAttribute('meta[property="og:url"]', 'content');
        expect(ogUrl).toBeTruthy();
        if (pageMeta.path !== '/') {
          expect(ogUrl).toContain(pageMeta.path);
        }
      });

      test(`has twitter:card meta tag`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const twitterCard = await page.getAttribute('meta[name="twitter:card"]', 'content');
        expect(twitterCard).toBe('summary_large_image');
      });

      test(`has no duplicate title tags`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const titleCount = await page.locator('title').count();
        expect(titleCount).toBe(1);
      });

      test(`has no duplicate meta description tags`, async ({ page }) => {
        await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
        const descCount = await page.locator('meta[name="description"]').count();
        expect(descCount).toBe(1);
      });
    });
  }
});

test.describe('SEO Structured Data — JSON-LD', () => {
  test('homepage has VideoGame JSON-LD schema', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const scripts = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    expect(scripts.length).toBeGreaterThan(0);

    let foundVideoGame = false;
    for (const script of scripts) {
      const data = JSON.parse(script);
      if (data['@type'] === 'VideoGame') {
        foundVideoGame = true;
        expect(data['@context']).toBe('https://schema.org');
        expect(data.name).toBe('GridLock');
        expect(data.url).toContain('gridlock');
        expect(data.genre).toEqual(expect.arrayContaining(['Strategy', 'Board Game', 'Puzzle']));
        expect(data.numberOfPlayers).toBeDefined();
        expect(data.numberOfPlayers.minValue).toBe(1);
        expect(data.numberOfPlayers.maxValue).toBe(4);
        expect(data.playMode).toEqual(expect.arrayContaining(['MultiPlayer', 'SinglePlayer']));
        expect(data.applicationCategory).toBe('Game');
        expect(data.operatingSystem).toBe('Web Browser');
        expect(data.offers).toBeDefined();
        expect(data.offers.price).toBe('0');
      }
    }
    expect(foundVideoGame).toBe(true);
  });

  test('homepage has FAQPage JSON-LD schema', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const scripts = await page.locator('script[type="application/ld+json"]').allInnerTexts();

    let foundFAQ = false;
    for (const script of scripts) {
      const data = JSON.parse(script);
      if (data['@type'] === 'FAQPage') {
        foundFAQ = true;
        expect(data['@context']).toBe('https://schema.org');
        expect(data.mainEntity).toBeDefined();
        expect(data.mainEntity.length).toBeGreaterThanOrEqual(2);
        for (const q of data.mainEntity) {
          expect(q['@type']).toBe('Question');
          expect(q.name).toBeTruthy();
          expect(q.acceptedAnswer).toBeDefined();
          expect(q.acceptedAnswer['@type']).toBe('Answer');
          expect(q.acceptedAnswer.text).toBeTruthy();
        }
      }
    }
    expect(foundFAQ).toBe(true);
  });

  test('each page has WebPage JSON-LD schema', async ({ page }) => {
    for (const pageMeta of PAGE_META) {
      await page.goto(`${BASE_URL}${pageMeta.path}`, { waitUntil: 'networkidle' });
      const scripts = await page.locator('script[type="application/ld+json"]').allInnerTexts();
      const hasWebPage = scripts.some((s) => {
        try {
          const data = JSON.parse(s);
          return data['@type'] === 'WebPage';
        } catch {
          return false;
        }
      });
      expect(hasWebPage).toBe(true);
    }
  });
});
