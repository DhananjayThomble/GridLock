# GridLock UI/UX Design Audit Report

**Date:** 2026-04-03  
**Auditor:** Kartik (automated + AI-assisted)  
**Scope:** All 5 pages × 3 viewports × 2 themes (48 screenshots)  
**Tools:** Playwright + axe-core (accessibility), Gemini 3 Flash Preview (vision analysis)

---

## Executive Summary

GridLock's UI is **functional and visually cohesive** but has **significant accessibility gaps** — particularly in dark mode and on mobile touch targets. The audit found:

- **3 WCAG 2 AA violations** (all in dark mode, all contrast-related)
- **18 tap-target issues** (elements below 44×44px minimum)
- **13 contrast problems** across both themes
- **Average mobile UX score: 6.5/10** (Gemini analysis)
- **Worst page: Leaderboard** at 5/10 with only 40% tap target compliance

**No critical layout breaks or overflow issues** were detected — the app renders correctly across viewports.

---

## Layer 1: Automated Accessibility (axe-core)

### Methodology
Playwright navigated all 6 pages in both light and dark themes at desktop viewport. axe-core v4.11 ran on each page, testing against WCAG 2 AA standards.

### Results

| Page | Theme | Violations | Passes | Incomplete |
|------|-------|-----------|--------|------------|
| Lobby | Light | 0 | 19 | 2 |
| Lobby | Dark | 0 | 19 | 2 |
| Leaderboard | Light | 0 | 20 | 1 |
| **Leaderboard** | **Dark** | **1 (2 elements)** | 20 | 1 |
| History | Light | 0 | 21 | 1 |
| History | Dark | 0 | 21 | 1 |
| How-to-Play | Light | 0 | 22 | 1 |
| **How-to-Play** | **Dark** | **1 (1 element)** | 22 | 1 |
| Settings | Light | 0 | 19 | 1 |
| **Settings** | **Dark** | **1 (1 element)** | 19 | 1 |

### Key Finding: Dark Mode Accent Contrast
All violations share the same root cause:
- **Foreground:** `#ffffff` (white text)
- **Background:** `#4d8fcc` (accent color)
- **Measured ratio:** 3.43:1
- **Required ratio:** 4.5:1 (WCAG AA for normal text)

Affected elements:
1. Casual/Ranked toggle buttons (leaderboard)
2. Search button (leaderboard)
3. "Start a Game Now 🎯" CTA (how-to-play)
4. Sign In button (settings)

---

## Layer 2: Gemini Vision Analysis

### Methodology
10 representative screenshots (9 mobile + 1 desktop) were analyzed by Gemini 3 Flash Preview. Each image was evaluated for tap targets, contrast, spacing, hierarchy, overflow, and layout.

### Page Scores

| Screenshot | Score | Tap Targets | Spacing | Contrast |
|-----------|-------|-------------|---------|----------|
| lobby-mobile-light | 7/10 | 65% | Good | Moderate |
| lobby-mobile-dark | 6/10 | 60% | Moderate | Poor |
| lobby-join-panel-mobile | 7/10 | 70% | Moderate | Moderate |
| lobby-validation-mobile | 7/10 | 70% | Moderate | Moderate |
| leaderboard-mobile | **5/10** | **40%** | **Poor** | Moderate |
| history-mobile | 7/10 | 85% | Good | Moderate |
| how-to-play-mobile | 7/10 | 85% | Good | Moderate |
| settings-mobile-light | 6/10 | Low | Good | Poor |
| settings-mobile-dark | 6/10 | 65% | Good | Poor |
| lobby-desktop-light | 7/10 | 65% | Good | Moderate |

### Issue Breakdown

| Category | Count | Critical | Major | Minor |
|----------|-------|----------|-------|-------|
| Tap targets | 18 | 1 | 10 | 7 |
| Contrast | 13 | 1 | 5 | 7 |
| Layout | 8 | 0 | 0 | 8 |
| Hierarchy | 7 | 0 | 1 | 6 |
| Spacing | 5 | 0 | 0 | 5 |
| Overflow | 1 | 0 | 0 | 1 |
| **Total** | **52** | **2** | **16** | **34** |

### Critical Issues
1. **Banner close button ('×')**: ~20px — half the minimum touch target. Appears on most pages.
2. **Dark mode secondary text**: Near-invisible helper text in settings (below 3:1 contrast).

### Top Major Issues
1. Header profile icon: ~36×36px (below 44px minimum)
2. Toggle buttons (Casual/Ranked): ~38px height
3. Settings toggle switches: ~40×24px
4. Placeholder text contrast: ~2.5:1 (needs 4.5:1)
5. Orange player name text: ~2.5:1 against light background
6. Navigation placed inline instead of fixed position

---

## GitHub Issues Filed

| # | Title | Priority |
|---|-------|----------|
| [#503](https://github.com/DhananjayThomble/GridLock/issues/503) | Dark mode contrast fails WCAG AA on accent-colored buttons | High |
| [#504](https://github.com/DhananjayThomble/GridLock/issues/504) | Tap targets below 44×44px minimum across mobile views | High |
| [#505](https://github.com/DhananjayThomble/GridLock/issues/505) | Low contrast on secondary text and placeholders | High |
| [#506](https://github.com/DhananjayThomble/GridLock/issues/506) | Navigation placement breaks mobile UX conventions | Medium |
| [#507](https://github.com/DhananjayThomble/GridLock/issues/507) | Leaderboard page has worst mobile UX score (5/10) | Medium |
| [#508](https://github.com/DhananjayThomble/GridLock/issues/508) | Dark mode specific issues across settings and lobby | High |

---

## Prioritized Fix Recommendations

### P0 — Fix Immediately (Accessibility Compliance)
1. **Darken dark-mode accent color** (`#4d8fcc` → `#3070a8`) to achieve 4.5:1 contrast with white text
2. **Increase banner close button** hit area to 44×44px minimum
3. **Fix secondary text contrast** in dark mode (use `#a0a0a0` minimum)

### P1 — Fix Soon (Mobile Usability)
4. **Set `min-height: 44px`** on all buttons, inputs, and interactive elements
5. **Increase toggle switch hit areas** — make full row tappable
6. **Darken placeholder text** to at least `#767676` (4.5:1 on white)

### P2 — Fix When Possible (UX Polish)
7. **Rework leaderboard spacing** — add consistent gaps between entries
8. **Consider fixed bottom navigation** for better mobile patterns
9. **Define design tokens** for secondary text that automatically meet contrast requirements

### P3 — Long-term (Infrastructure)
10. **Integrate axe-core tests into CI** — the Playwright tests from this audit can run on every PR
11. **Add automated contrast checking** to the design system
12. **Set up visual regression testing** for theme changes

---

## Methodology Notes

- **Layer 1 (axe-core):** Automated WCAG 2 AA testing via Playwright. Tests ran at 1280×720 desktop viewport. 48 screenshots captured across 3 viewports (mobile 375px, tablet 768px, desktop 1280px) × 2 themes × 6 pages + interactive states.
- **Layer 2 (Gemini):** AI vision analysis of 10 curated screenshots using `gemini-3-flash-preview`. Focused on mobile views where touch target issues are most impactful, plus 1 desktop reference.
- **Layer 3 (Strategic Review):** Findings synthesized from Layers 1-2 to identify systemic patterns and prioritize fixes.

## Raw Data
- Screenshots: `frontend/tests/design-audit/screenshots/` (48 files)
- Accessibility report: `frontend/tests/design-audit/reports/accessibility.json`
- Gemini analysis: `frontend/tests/design-audit/reports/gemini-analysis.json`
