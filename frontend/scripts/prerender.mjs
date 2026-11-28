/**
 * prerender.mjs — Static prerendering for SEO
 *
 * Renders key routes in headless Chromium after `vite build`, saving the
 * fully-rendered HTML (with react-helmet-async <title>, OG tags, etc.)
 * so non-JS crawlers (Facebook, LinkedIn, Telegram bots) see correct meta.
 *
 * Usage:  node scripts/prerender.mjs
 * Prereq: `vite build` must have already produced frontend/dist/
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { preview } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
// Public, indexable pages only (keep in sync with scripts/generate-sitemap.mjs)
const ROUTES = ['/', '/how-to-play', '/leaderboard', '/daily', '/challenge', '/privacy'];
const PREVIEW_PORT = 4174;

// Detect system Chromium (snap or apt)
function findChromium() {
  const candidates = [
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined; // let Puppeteer use its bundled one
}

async function prerender() {
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ not found — run `vite build` first.');
    process.exit(1);
  }

  // Start Vite preview server on the built dist/
  const server = await preview({
    preview: { port: PREVIEW_PORT, strictPort: true },
    build: { outDir: DIST_DIR },
  });

  const executablePath = findChromium();
  console.log(`Using Chromium: ${executablePath || '(bundled)'}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  // Build a separate SPA shell for utility routes from the unrendered entry.
  const shellPage = await browser.newPage();
  try {
    const entry = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
    const appShell = await shellPage.evaluate((html) => {
      const shell = new DOMParser().parseFromString(html, 'text/html');
      shell.querySelectorAll('[data-static-seo], script[type="application/ld+json"]').forEach((node) => node.remove());

      const title = shell.createElement('title');
      title.textContent = 'GridLock';
      title.setAttribute('data-static-seo', '');
      const robots = shell.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex, nofollow';
      robots.setAttribute('data-static-seo', '');
      shell.head.append(title, robots);
      return '<!doctype html>\n' + shell.documentElement.outerHTML;
    }, entry);
    writeFileSync(join(DIST_DIR, 'app.html'), appShell);
  } finally {
    await shellPage.close();
  }

  let failed = false;

  for (const route of ROUTES) {
    let page;
    try {
      console.log(`Prerendering ${route} ...`);
      page = await browser.newPage();

      // Block analytics / tracking to keep prerendered HTML clean
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const raw = req.url();
        let host = '';
        let path = '';
        try {
          const u = new URL(raw);
          host = u.hostname;
          path = u.pathname;
        } catch {
          // Non-absolute / data: URLs — fall back to the raw string for matching
          host = raw;
          path = raw;
        }
        // Block analytics / tracking hosts and the Socket.IO endpoint so the
        // prerendered HTML stays clean. Match host/path segments rather than a
        // bare substring to avoid matching unrelated URLs.
        const blockedHost = /(^|\.)(posthog|sentry)\.|analytics/i.test(host);
        const blockedPath = /\/socket\.io\//.test(path);
        if (blockedHost || blockedPath) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(`http://localhost:${PREVIEW_PORT}${route}`, {
        // The SPA can keep API requests open while its SEO metadata is already ready.
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Wait for route-specific metadata. The initial HTML always has a homepage title.
      await page.waitForFunction(
        (expectedPath) => {
          const canonical = document.head.querySelector('link[rel="canonical"][data-route-seo]');
          const hasPageSchema = document.querySelector('script[data-route-seo]');
          return canonical
            && new URL(canonical.href).pathname === expectedPath
            && hasPageSchema
            && !document.querySelector('[data-static-seo]');
        },
        { timeout: 8000 },
        route === '/' ? route : `${route}/`,
      );

      // On the next app mount, the generated tags are replaced by React's fresh tags.
      await page.evaluate(() => {
        document.querySelectorAll('[data-route-seo]').forEach((tag) => {
          tag.removeAttribute('data-route-seo');
          tag.setAttribute('data-static-seo', '');
        });
      });
      let html = await page.content();

      // Add a marker comment so we can verify prerendering worked
      html = html.replace(
        '<head>',
        `<head>\n<!-- prerendered: ${route} @ ${new Date().toISOString()} -->`,
      );

      // Write to dist/<route>/index.html (homepage overwrites dist/index.html)
      const outPath =
        route === '/'
          ? join(DIST_DIR, 'index.html')
          : join(DIST_DIR, route.slice(1), 'index.html');

      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html, 'utf-8');
      console.log(`  ✅ ${outPath}`);
    } catch (err) {
      console.error(`  ❌ Failed to prerender ${route}:`, err.message);
      failed = true;
    } finally {
      await page?.close();
    }
  }

  await browser.close();
  server.httpServer.close();

  if (failed) {
    console.error('\n❌ Some routes failed to prerender.');
    process.exit(1);
  }

  console.log('\n✅ Prerendering complete!');
}

prerender().catch((err) => {
  console.error('Fatal prerender error:', err);
  process.exit(1);
});
