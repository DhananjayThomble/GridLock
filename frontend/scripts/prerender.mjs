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
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { preview } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
// Public, indexable pages only (keep in sync with scripts/generate-sitemap.mjs)
const ROUTES = ['/', '/how-to-play', '/leaderboard', '/daily'];
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

/**
 * Clean up duplicate tags left by react-helmet-async.
 *
 * Helmet prepends its <title> (so the first <title> is the correct one)
 * and appends its <meta>/<link> tags (so the last occurrence of each
 * property/name is the correct one). We deduplicate accordingly.
 */
function cleanHtml(html) {
  // 1. Keep only the FIRST <title> tag (Helmet prepends the most recent)
  let titleCount = 0;
  html = html.replace(/<title>[\s\S]*?<\/title>/gi, (match) => {
    titleCount++;
    return titleCount === 1 ? match : '';
  });

  // 2. For <meta> tags with property or name, keep only the LAST occurrence
  //    of each unique property/name value (Helmet appends at end of <head>)
  const metaRegex = /<meta\s+[^>]*(?:property|name)="([^"]+)"[^>]*>/gi;
  const metaOccurrences = new Map(); // key -> array of { match, index }
  let match;
  let allMatches = [];

  // Collect all meta tags
  while ((match = metaRegex.exec(html)) !== null) {
    const key = match[1].toLowerCase();
    if (!metaOccurrences.has(key)) metaOccurrences.set(key, []);
    metaOccurrences.get(key).push({ full: match[0], index: match.index });
    allMatches.push({ full: match[0], index: match.index, key });
  }

  // Build set of meta tags to remove (all but last for each key)
  const toRemove = new Set();
  for (const [, occurrences] of metaOccurrences) {
    if (occurrences.length > 1) {
      // Keep only the last one, remove all others
      for (let i = 0; i < occurrences.length - 1; i++) {
        toRemove.add(occurrences[i].full + '|' + occurrences[i].index);
      }
    }
  }

  if (toRemove.size > 0) {
    // Remove duplicates by replacing from end to start (to preserve indices)
    const removals = [...toRemove].map((r) => {
      const pipeIdx = r.lastIndexOf('|');
      return { full: r.slice(0, pipeIdx), index: parseInt(r.slice(pipeIdx + 1)) };
    }).sort((a, b) => b.index - a.index);

    for (const { full, index } of removals) {
      html = html.slice(0, index) + html.slice(index + full.length);
    }
  }

  // 3. For <link rel="canonical">, keep only the last one
  const canonicalRegex = /<link\s+rel="canonical"[^>]*>/gi;
  const canonicals = [];
  while ((match = canonicalRegex.exec(html)) !== null) {
    canonicals.push({ full: match[0], index: match.index });
  }
  if (canonicals.length > 1) {
    // Remove all but last, from end to start
    for (let i = canonicals.length - 2; i >= 0; i--) {
      const { full, index } = canonicals[i];
      html = html.slice(0, index) + html.slice(index + full.length);
    }
  }

  return html;
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

  let failed = false;

  for (const route of ROUTES) {
    try {
      console.log(`Prerendering ${route} ...`);
      const page = await browser.newPage();

      // Block analytics / tracking to keep prerendered HTML clean
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const { hostname, pathname } = new URL(req.url());
        const isTracker = ['posthog', 'sentry', 'analytics'].some((name) => hostname.includes(name));
        if (isTracker || pathname.startsWith('/socket.io')) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(`http://localhost:${PREVIEW_PORT}${route}`, {
        waitUntil: 'networkidle0',
        timeout: 20000,
      });

      // Give react-helmet-async a moment to inject tags
      await page.waitForFunction(
        () => {
          const title = document.title;
          return title && title !== 'GridLock' && title.length > 0;
        },
        { timeout: 8000 },
      ).catch(() => {
        // Homepage might keep default title pattern — that's OK
        if (route !== '/') {
          console.warn(`  ⚠ Title didn't change from default for ${route}`);
        }
      });

      let html = await page.content();

      // Clean up duplicate tags from react-helmet-async
      html = cleanHtml(html);

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
      await page.close();
    } catch (err) {
      console.error(`  ❌ Failed to prerender ${route}:`, err.message);
      failed = true;
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
