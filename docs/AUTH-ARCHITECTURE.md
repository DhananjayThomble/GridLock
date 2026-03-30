# Google OAuth Authentication — Architecture & Implementation Plan

**Issue:** #467
**Status:** Approved — implementation-ready spec
**Date:** 2026-03-30

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [OAuth Flow](#2-oauth-flow)
3. [Database Schema](#3-database-schema)
4. [API Contracts](#4-api-contracts)
5. [JWT Strategy](#5-jwt-strategy)
6. [Middleware Design](#6-middleware-design)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Guest → Account Migration](#8-guest--account-migration)
9. [Existing Feature Integration](#9-existing-feature-integration)
10. [Security Considerations](#10-security-considerations)
11. [Test Plan (TDD)](#11-test-plan-tdd)
12. [Deployment & Rollback](#12-deployment--rollback)
13. [File Change Manifest](#13-file-change-manifest)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                        │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ AuthContext  │  │ Avatar (top- │  │ Settings page          │  │
│  │ (provider)  │  │ right circle)│  │ (sign-in backup)       │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                │                       │              │
│         └────────────────┴───────────────────────┘              │
│                          │                                      │
│              axios.defaults.withCredentials = true               │
│              GET /api/auth/me (on load)                         │
│              GET /api/auth/google (sign-in click)               │
│              POST /api/auth/logout (sign-out click)             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────┴──────────────────────────────────────┐
│                      BACKEND (Express)                          │
│                                                                 │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ routes/auth.js │  │ middleware/  │  │ Existing routes      │ │
│  │                │  │ auth.js      │  │ (profile, ranked,    │ │
│  │ /google       │  │              │  │  daily, history,     │ │
│  │ /google/cb    │  │ optionalAuth │  │  leaderboard)        │ │
│  │ /me           │  │ requireAuth  │  │                      │ │
│  │ /logout       │  │ csrfHeader   │  │ Enhanced with         │ │
│  │ /delete       │  │              │  │ optionalAuth          │ │
│  └───────┬───────┘  └──────────────┘  └─────────────────────┘ │
│          │                                                      │
│  Express CORS: credentials: true                                │
│  Socket.IO CORS: credentials: true                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    MongoDB                                 │  │
│  │  ┌─────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────┐ │  │
│  │  │ User    │ │ Leaderboard│ │ RankedProfile│ │DailyResult│ │  │
│  │  │(NEW)    │ │ (+userId)  │ │ (+userId)    │ │(+userId) │ │  │
│  │  └─────────┘ └────────────┘ └─────────────┘ └──────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Zero-friction first** — Guest play is unchanged. No auth required for any current game flow.
2. **Progressive enhancement** — Auth adds persistence, not access.
3. **No Passport.js** — It's overkill for a single OAuth provider. We'll use Google's OAuth2 API directly with `google-auth-library` (Google's official Node.js SDK). Fewer deps, less magic, more control.
4. **Stateless sessions** — JWT in httpOnly cookie. No server-side session store.
5. **Backward compatible** — All existing username-based APIs continue to work. `userId` is additive.
6. **Credentials everywhere** — Both Express CORS and Socket.IO CORS must set `credentials: true` so cookies flow on cross-origin requests.

---

## 2. OAuth Flow

### 2a. Sign-In Flow (Authorization Code Grant)

```
User clicks "Sign in with Google"
        │
        ▼
Frontend redirects to:
  GET /api/auth/google?returnTo=/settings
        │
        ▼
Backend encodes returnTo + CSRF token into state parameter:
  state = base64(JSON.stringify({ csrf: randomToken, returnTo: '/settings' }))
Stores csrf in httpOnly cookie, redirects to Google:
  https://accounts.google.com/o/oauth2/v2/auth
    ?client_id=...
    &redirect_uri=https://api.gridlock.pro/api/auth/google/callback
    &response_type=code
    &scope=openid email profile
    &state=<encoded_state>
    &prompt=select_account
    &access_type=online
        │
        ▼
User selects account / consents on Google
        │
        ▼
Google redirects to:
  GET /api/auth/google/callback?code=...&state=...
        │
        ▼
Backend:
  1. Decode state: JSON.parse(base64decode(state))
  2. Verify csrf from decoded state matches cookie (CSRF check)
  3. Extract returnTo from decoded state
  4. Exchange code for tokens with Google
  5. Verify ID token, extract: googleId, email, name, picture
  6. Find or create User document
  7. Generate JWT, set in httpOnly cookie
  8. Redirect to frontend: https://gridlock.pro{returnTo}
        │
        ▼
Frontend:
  AuthContext detects cookie via GET /api/auth/me
  UI updates: avatar appears top-right, "Save progress" nudge disappears
```

**OAuth URL parameters:**
- `prompt=select_account` — Lets returning users pick which Google account without forcing full re-consent every time. First-time users still see the consent screen automatically.
- `access_type=online` — We only need the ID token, not offline refresh tokens. Explicit is better than relying on defaults.

**State parameter encoding:**
The `returnTo` path is encoded inside the OAuth state parameter (alongside the CSRF token) rather than stored in a separate cookie or session. This keeps the flow fully stateless:
```javascript
const state = Buffer.from(JSON.stringify({
  csrf: crypto.randomBytes(32).toString('hex'),
  returnTo: validateReturnTo(req.query.returnTo)
})).toString('base64url');
```

### 2b. Why Authorization Code (not Implicit/PKCE)?

- We have a backend — use it. Authorization Code is the most secure flow.
- Client secret stays server-side. No tokens in URL fragments.
- ID token verification happens server-side with Google's library.

### 2c. Why NOT Passport.js?

| Factor | Passport.js | google-auth-library |
|--------|-------------|---------------------|
| Dependencies | passport + passport-google-oauth20 + express-session | google-auth-library only |
| Session management | Requires session middleware (express-session or cookie-session) | We handle JWT ourselves (already our plan) |
| Complexity | serialize/deserialize, strategy config, session middleware | ~50 lines of code for the entire flow |
| Control | Abstracted away | Full visibility into every step |
| Single provider | Overhead of generic framework for 1 provider | Purpose-built |

For a single OAuth provider, Passport.js adds 3 deps and forced patterns we don't need. Direct integration is cleaner.

---

## 3. Database Schema

### 3a. User Model (New)

```javascript
// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // ── Identity ──
  googleId: {
    type: String,
    required: true,
    unique: true,     // creates index automatically
  },
  email: {
    type: String,
    required: true,
    unique: true,     // creates index automatically
    lowercase: true,
    trim: true,
  },

  // ── Profile ──
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30,
  },
  username: {
    type: String,
    required: true,
    unique: true,     // creates index automatically
    trim: true,
    minlength: 2,
    maxlength: 16,
    match: /^[a-zA-Z0-9_-]+$/,
  },
  usernameSetupComplete: {
    type: Boolean,
    default: false,   // true after user picks their permanent username
  },
  avatar: {
    type: String,     // Google profile picture URL
    default: null,
  },

  // ── Metadata ──
  lastLoginAt: {
    type: Date,
    default: Date.now,  // Updated on each Google sign-in, NOT on every save
  },

  // ── Data Migration ──
  migratedFromGuest: {
    type: String,     // The guest username whose data was merged
    default: null,
  },
}, {
  timestamps: true,   // auto-manages createdAt + updatedAt
});

// No explicit index() calls — field-level `unique: true` already creates indexes.
// Adding UserSchema.index() on the same fields would create duplicate indexes.

module.exports = mongoose.model('User', UserSchema);
```

**Key decisions:**
- **Removed `password` and `bcrypt`** — We're OAuth-only. No email/password auth. Keeping dead code invites confusion.
- **`username` is user-chosen** — On first sign-in, user picks a username (Google displayName as suggestion). This becomes their permanent identity. Username changes are **not supported in v1** — this is a deliberate decision to simplify data integrity. Can revisit later if users request it.
- **`usernameSetupComplete`** — Boolean flag for clean new-user detection. `false` means the user has a temporary auto-generated username and needs to pick one. Cleaner than checking if the username matches a temporary pattern.
- **`username` validation** — Same regex as existing `sanitizeUsername`: `^[a-zA-Z0-9_-]+$`, 2-16 chars. Consistent with existing game system.
- **`migratedFromGuest`** — Tracks if this account absorbed guest data (one-time migration).
- **`timestamps: true`** — Mongoose auto-manages `createdAt` and `updatedAt`. We do NOT define a manual `createdAt` field (that would conflict with the timestamps plugin). `lastLoginAt` is separate because it has specific semantics: updated only on Google sign-in, not on every document save.
- **No duplicate indexes** — `unique: true` on field definitions already creates indexes. Do not add explicit `UserSchema.index()` calls for the same fields.
- **No `highScores`** — That data lives in `Leaderboard` and `RankedProfile` models already.

### 3b. Existing Model Changes

**No schema changes to existing models.** Instead, we add an **optional** `userId` field to models that currently use `username` as identity:

```javascript
// Added to: Leaderboard, RankedProfile, GameHistory, DailyResult
userId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  default: null,
  index: true,
  sparse: true,  // Allow nulls (guests don't have userId)
}
```

**DailyResult additional index:**

```javascript
// Sparse unique compound index for one-attempt-per-day enforcement
DailyResultSchema.index({ date: 1, userId: 1 }, { unique: true, sparse: true });
```

**Enforcement logic:** For authenticated users, check `userId + date` FIRST to enforce one attempt per day. For guests (`userId: null`), fall back to `username + date`. The sparse index only covers documents where `userId` is non-null, so guest entries don't conflict.

**Why optional/sparse?**
- Guests still create Leaderboard/RankedProfile entries with `username` only and `userId: null`
- Authenticated users get their `userId` set
- Existing data doesn't break — `userId` defaults to `null`
- Queries can work by either `username` (backward compat) or `userId` (authenticated)

### 3c. Migration Strategy

No data migration needed on deploy. The `userId` field is optional with a default of `null`. Existing documents are unaffected. When a user authenticates and migrates guest data, we retroactively set `userId` on their existing records.

---

## 4. API Contracts

### `GET /api/auth/google`

Initiates OAuth flow. Redirects to Google consent screen.

**Query params:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `returnTo` | string | No | Frontend path to redirect after auth (default: `/`) |

**Response:** 302 redirect to Google

**Security:** `returnTo` is validated against allowlist of frontend paths (no open redirect). The validated `returnTo` is encoded inside the OAuth `state` parameter alongside the CSRF token.

---

### `GET /api/auth/google/callback`

Google redirects here after consent. Handles token exchange and user creation.

**Query params (from Google):**
| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Authorization code |
| `state` | string | Base64-encoded JSON: `{ csrf, returnTo }` |
| `error` | string | Error code (if user denied) |

**Response:** 302 redirect to frontend with JWT cookie set.

**State handling:**
1. Decode state: `JSON.parse(Buffer.from(state, 'base64url'))`
2. Verify `csrf` matches the value stored in the httpOnly cookie
3. Extract `returnTo` for the final redirect

**Error cases:**
| Scenario | Behavior |
|----------|----------|
| User denies consent | Redirect to `/?auth=cancelled` |
| Invalid state (CSRF) | Redirect to `/?auth=error` |
| Google API error | Redirect to `/?auth=error` |
| Token exchange fails | Redirect to `/?auth=error` |

**On success (existing user):** Set JWT cookie → redirect to `returnTo`
**On success (new user):** Set JWT cookie, set `usernameSetupComplete: false` → redirect to `/auth/setup` (username pick page)

---

### `GET /api/auth/me`

Returns current authenticated user, or null.

**Headers:** Cookie with `gridlock_token` JWT

**Response (authenticated):**
```json
{
  "success": true,
  "user": {
    "id": "665f1a2b3c4d5e6f7a8b9c0d",
    "username": "DJ_Grid",
    "displayName": "Dhananjay Thomble",
    "email": "dj@example.com",
    "avatar": "https://lh3.googleusercontent.com/...",
    "usernameSetupComplete": true,
    "createdAt": "2026-03-30T10:00:00Z"
  }
}
```

**Response (guest / no cookie):**
```json
{
  "success": true,
  "user": null
}
```

**Note:** Never returns 401. Guests get `user: null`, not an error. This keeps the frontend simple — AuthContext just checks `user !== null`.

---

### `POST /api/auth/logout`

Clears the JWT cookie.

**Headers:** Requires `X-Requested-With: XMLHttpRequest` header (CSRF protection).

**Response:**
```json
{ "success": true }
```

---

### `DELETE /api/auth/account`

Deletes user account and all associated data. GDPR compliance.

**Headers:** Cookie with `gridlock_token` JWT (required). Requires `X-Requested-With: XMLHttpRequest` header (CSRF protection).

**Response:**
```json
{ "success": true, "message": "Account and all associated data deleted" }
```

**Actions:**
1. Delete `User` document
2. Remove `userId` from all `Leaderboard`, `RankedProfile`, `GameHistory`, `DailyResult` docs (data becomes anonymous/guest again — not deleted, since the game data belongs to the game history)
3. Clear JWT cookie

**Note:** Google OAuth consent is NOT revoked server-side. If the user returns and signs in with Google again, they will auto-authenticate. This is acceptable for v1 — revoking consent would require storing and managing Google refresh tokens, which adds complexity for minimal benefit in a game app.

---

### `POST /api/auth/setup-username`

Called after first Google sign-in to pick a username.

**Headers:** Cookie with `gridlock_token` JWT (required, `usernameSetupComplete` must be `false`). Requires `X-Requested-With: XMLHttpRequest` header (CSRF protection).

**Body:**
```json
{
  "username": "DJ_Grid"
}
```

**Response (success):**
```json
{
  "success": true,
  "user": { "id": "...", "username": "DJ_Grid", "usernameSetupComplete": true, ... }
}
```

**Response (taken — 409):**
```json
{
  "success": false,
  "error": "Username already taken"
}
```

**Implementation — race condition handling:**

Do NOT rely on a pre-check query alone. Use try/catch on the actual write:

```javascript
try {
  user.username = validatedUsername;
  user.usernameSetupComplete = true;
  await user.save();
} catch (err) {
  if (err.code === 11000) {
    return res.status(409).json({ success: false, error: 'Username already taken' });
  }
  throw err;
}
```

The `unique: true` index on `username` is the real enforcement. The pre-check (availability lookup) is a UX convenience for the frontend, not a guarantee.

**Validation:**
- 2-16 characters
- `^[a-zA-Z0-9_-]+$`
- Not a reserved word (`admin`, `system`, `gridlock`, `null`, `undefined`, etc.)

---

### `POST /api/auth/migrate-guest`

Migrates guest data to an authenticated account. See [Section 8](#8-guest--account-migration) for full details.

**Headers:** Requires `X-Requested-With: XMLHttpRequest` header (CSRF protection).

---

## 5. JWT Strategy

### Token Structure

```javascript
{
  sub: "665f1a2b3c4d5e6f7a8b9c0d",  // User._id (only identifier in token)
  iat: 1711785600,
  exp: 1712390400  // 7 days
}
```

The JWT contains only `sub` (user ID), `iat`, and `exp`. No `username` or other claims. Since `optionalAuth` already does a DB lookup on every authenticated request, the username and other profile data come from that lookup. Keeping the token minimal means we never have stale claims.

### Cookie Configuration

```javascript
res.cookie('gridlock_token', jwt, {
  httpOnly: true,       // Not accessible via JS (XSS protection)
  secure: true,         // HTTPS only (prod)
  sameSite: 'lax',      // CSRF protection for GET requests
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
  path: '/',
  domain: '.gridlock.pro',  // Shared across api.gridlock.pro and gridlock.pro
});
```

**Why `domain: .gridlock.pro`?**
- Frontend is at `gridlock.pro`, backend at `api.gridlock.pro`
- Cookie must be readable by both subdomains
- The leading dot means "this domain and all subdomains"

**Why `sameSite: lax`?**
- `strict` would break the OAuth callback (Google redirects back → cookie not sent on the redirect)
- `lax` sends cookies on top-level navigations (GET) but blocks cross-origin POST — perfect for our flow

### Token Refresh Strategy

**No refresh tokens.** Simplicity wins for a game app:
- JWT lasts 7 days
- On expiry, user clicks "Sign in" again (one click, Google remembers account via `prompt=select_account`)
- This avoids refresh token rotation complexity, token storage, and the associated security surface

If we later need longer sessions, we can add silent refresh via iframe.

### JWT Secret

- Generated once per environment: `crypto.randomBytes(64).toString('hex')`
- Stored in `.env` as `JWT_SECRET`
- **Separate secrets for prod and beta** — a stolen beta token cannot access prod, and vice versa

```bash
# Production .env
JWT_SECRET=<prod-specific-value>

# Beta .env
JWT_SECRET=<beta-specific-value>
```

---

## 6. Middleware Design

### `optionalAuth` — The Workhorse

```javascript
// middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Attaches req.user if a valid JWT cookie is present.
 * Does NOT reject unauthenticated requests — passes through.
 * Use this on routes that work for both guests and authenticated users.
 *
 * TODO: If latency becomes an issue, trust JWT claims in optionalAuth
 * and skip DB lookup. For v1, DB lookup ensures revoked accounts are
 * caught immediately.
 */
async function optionalAuth(req, res, next) {
  const token = req.cookies?.gridlock_token;
  if (!token) return next();  // Guest — continue without user

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (user) {
      req.user = user;
    }
    // If user not found (deleted account), silently treat as guest
  } catch (err) {
    // Invalid/expired token — treat as guest, clear stale cookie
    res.clearCookie('gridlock_token', { domain: '.gridlock.pro', path: '/' });
  }
  next();
}

/**
 * Requires authentication. Returns 401 if no valid token.
 * Use for protected routes (account deletion, username setup, etc).
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.gridlock_token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (!user) {
      res.clearCookie('gridlock_token', { domain: '.gridlock.pro', path: '/' });
      return res.status(401).json({ success: false, error: 'Account not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('gridlock_token', { domain: '.gridlock.pro', path: '/' });
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * CSRF header check for state-changing endpoints.
 * Requires X-Requested-With: XMLHttpRequest header.
 * This blocks simple cross-origin form submissions that SameSite=Lax allows.
 */
function csrfHeader(req, res, next) {
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ success: false, error: 'Missing required header' });
  }
  next();
}

module.exports = { optionalAuth, requireAuth, csrfHeader };
```

### Where Each Middleware Applies

| Route | Middleware | Behavior |
|-------|-----------|----------|
| `GET /api/auth/me` | `optionalAuth` | Returns user or null |
| `POST /api/auth/logout` | `requireAuth`, `csrfHeader` | Must be logged in to log out |
| `DELETE /api/auth/account` | `requireAuth`, `csrfHeader` | Must be logged in to delete |
| `POST /api/auth/setup-username` | `requireAuth`, `csrfHeader` | Must be logged in |
| `POST /api/auth/migrate-guest` | `requireAuth`, `csrfHeader` | Must be logged in |
| `GET /api/profile/:username` | `optionalAuth` | Works for everyone, enhanced for owner |
| `GET /api/ranked/profile/:username` | `optionalAuth` | Same |
| `GET /api/games/history` | `optionalAuth` | Same |
| `GET /api/daily/*` | `optionalAuth` | Same |
| `GET /api/leaderboard` | None (unchanged) | Public data |
| All game Socket.IO events | None (unchanged) | Guest play works as-is |

---

## 7. Frontend Architecture

### 7a. AuthContext

```jsx
// src/contexts/AuthContext.jsx

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Set withCredentials globally — all axios requests include cookies.
// No need for per-call { withCredentials: true } config.
axios.defaults.withCredentials = true;

// Set CSRF header globally for all requests.
// State-changing endpoints require this; harmless on GETs.
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);        // null = guest, object = authenticated
  const [loading, setLoading] = useState(true);   // true until initial /me check completes

  // Check auth status on mount
  useEffect(() => {
    axios.get('/api/auth/me')
      .then(res => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(() => {
    // Redirect to backend OAuth endpoint
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `${import.meta.env.VITE_SOCKET_URL}/api/auth/google?returnTo=${returnTo}`;
  }, []);

  const logout = useCallback(async () => {
    await axios.post('/api/auth/logout');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await axios.get('/api/auth/me');
    setUser(res.data.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
```

### 7b. Avatar Component (Top-Right)

```
┌────────────────────────────────────────────┐
│  GridLock                          [Avatar] │  ← top-right corner
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │           Game Content                │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  [🏠] [🏆] [📖] [📜] [⚙️]                   │  ← bottom nav (unchanged)
└────────────────────────────────────────────┘
```

**Guest state:** Generic user icon (e.g., `👤`) → click opens sign-in prompt
**Authenticated state:** Google profile picture (circular, 32px) → click opens dropdown:
- `View Profile` → navigates to `/profile/{username}`
- `Sign Out`

### 7c. Username Setup Page

New route: `/auth/setup`

Shown after first Google sign-in when `usernameSetupComplete` is `false`:
- Google displayName pre-filled as suggestion
- Real-time availability check (debounced 300ms)
- Validation: 2-16 chars, alphanumeric + `_` + `-`
- "This will be your permanent username" label
- Submit → `POST /api/auth/setup-username` → redirect to original `returnTo`

### 7d. Settings Page Addition

Add new section to Settings.jsx:

```
┌─ Account ──────────────────────────────┐
│ 👤  Sign in with Google    [Button]    │  ← guest view
│                                        │
│ OR (when signed in):                   │
│                                        │
│ 🖼️  DJ_Grid                           │
│     dj@example.com                     │
│ 🚪  Sign Out               [Button]    │
│ 🗑️  Delete Account          [Button]   │  ← with confirmation modal
└────────────────────────────────────────┘
```

### 7e. "Save Your Progress" Nudges

Subtle, dismissable banners on specific pages (guests only):

- **Profile page:** "Sign in to save your stats across devices"
- **Ranked page:** "Sign in to keep your ELO rating permanent"
- **Daily challenge (after completing):** "Sign in to save your streak"

Dismissal stored in `localStorage` with 7-day expiry. Not shown again until expiry.

---

## 8. Guest → Account Migration

### Flow

```
Guest "CoolPlayer" has:
  - Leaderboard entry (50 wins)
  - RankedProfile (ELO 1400, Gold)
  - 30 GameHistory records
  - 15 DailyResult records

Guest signs in with Google → picks username "CoolPlayer" (or different)

If username matches existing guest data:
  → Prompt: "We found stats for 'CoolPlayer'. Link to your account?"
  → [Link Stats] → migrate all records
  → [Skip] → start fresh

If username is different:
  → Prompt: "Want to transfer stats from a previous name?"
  → Input field for old guest username
  → [Transfer] → migrate
  → [Start Fresh] → no migration
```

### Migration Logic (Backend)

```javascript
// POST /api/auth/migrate-guest
// Body: { guestUsername: "CoolPlayer" }

async function migrateGuestData(userId, guestUsername, user) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Leaderboard.updateMany(
        { username: guestUsername, userId: null },
        { $set: { userId } },
        { session }
      );
      await RankedProfile.updateMany(
        { username: guestUsername, userId: null },
        { $set: { userId } },
        { session }
      );
      await GameHistory.updateMany(
        { username: guestUsername, userId: null },
        { $set: { userId } },
        { session }
      );
      await DailyResult.updateMany(
        { username: guestUsername, userId: null },
        { $set: { userId } },
        { session }
      );
      await User.updateOne(
        { _id: userId },
        { $set: { migratedFromGuest: guestUsername } },
        { session }
      );
    });
  } finally {
    session.endSession();
  }
}
```

**Transaction note:** The migration is wrapped in a MongoDB transaction (`session.withTransaction()`) to ensure atomicity — either all records are migrated or none are. If not running on a replica set (e.g., local dev), the transaction will fail. However, the operation is **idempotent** because every query filters on `userId: null`. If a partial migration occurs and you retry, only the remaining un-migrated records will be updated. Safe to retry.

**Safeguards:**
- Only migrates records where `userId: null` (unclaimed guest data)
- Can only be called once per user (`migratedFromGuest` field set after migration)
- Guest username is validated with same `sanitizeUsername` logic

---

## 9. Existing Feature Integration

### What Changes

| Feature | Current (Guest) | After Auth (Authenticated) | After Auth (Guest) |
|---------|-----------------|---------------------------|-------------------|
| **Profile** | `/profile/:username` — shows stats by username | Same URL, but links to account. Owner sees "Edit" options | Unchanged |
| **Ranked** | ELO tied to username string | ELO tied to userId (persistent) | Unchanged |
| **Daily** | One attempt per username+date | One attempt per userId+date | Unchanged |
| **Game History** | By username | By userId (cross-device) | Unchanged |
| **Leaderboard** | By username | Shows avatar + ✓ verified badge for authenticated users | Unchanged |
| **Challenge Links** | `/play/:username` | Also works with authenticated usernames | Unchanged |

**Verified badge:** Authenticated users show a small ✓ next to their name on the leaderboard. This is a visual indicator only — it signals that the account is linked to a Google identity and the stats are persistent.

### Socket.IO Enhancement

Both Express and Socket.IO need `credentials: true` in their CORS config for cookies to flow on cross-origin requests:

```javascript
// server.js — Express CORS
app.use(cors({
  origin: function(origin, callback) { /* existing logic */ },
  credentials: true,
}));

// server.js — Socket.IO CORS
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) { /* same origin logic */ },
    credentials: true,  // Required for cookie-based auth over WebSocket
  },
});
```

When an authenticated user connects via Socket.IO, the backend reads the JWT from the handshake cookies:

```javascript
// Backend reads cookie from Socket.IO handshake
io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies.gridlock_token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = payload.sub;
    } catch {
      // Invalid token — treat as guest
    }
  }
  next();
});
```

**Why?** So when a game ends and we record stats to Leaderboard/RankedProfile/GameHistory, we can attach the `userId` if the player is authenticated. This happens transparently — the game logic doesn't change.

---

## 10. Security Considerations

### CSRF Protection

1. **OAuth state parameter:** CSRF token + returnTo encoded in state, CSRF verified against httpOnly cookie on callback
2. **SameSite=Lax cookie:** Blocks cross-origin POST with cookies
3. **`X-Requested-With` header check:** All state-changing auth endpoints (`POST /api/auth/logout`, `DELETE /api/auth/account`, `POST /api/auth/setup-username`, `POST /api/auth/migrate-guest`) require `X-Requested-With: XMLHttpRequest`. This blocks simple form submissions that `SameSite=Lax` still allows on some browsers. The `csrfHeader` middleware enforces this.

### XSS Protection

1. **httpOnly cookies:** JWT not accessible via `document.cookie`
2. **No tokens in localStorage:** Nothing to steal from JS context
3. **Existing Helmet config:** CSP, X-Frame-Options, etc. already configured

### Open Redirect Prevention

`returnTo` parameter validated:
```javascript
const ALLOWED_PATHS = /^\/[a-zA-Z0-9/_-]*$/;  // Only relative paths
function validateReturnTo(path) {
  if (!path) return '/';
  if (!ALLOWED_PATHS.test(path)) return '/';
  return path;
}
```

### Rate Limiting

| Endpoint | Limit | Window | Notes |
|----------|-------|--------|-------|
| `GET /api/auth/google` | 10 | 15 min | OAuth initiation |
| `GET /api/auth/google/callback` | 10 | 15 min | OAuth callback |
| `GET /api/auth/me` | Global | — | Covered by `httpLimiter` (100 req/15 min) |
| `POST /api/auth/setup-username` | 5 | 1 min | Username selection |
| `DELETE /api/auth/account` | 3 | 1 hour | Account deletion |
| `POST /api/auth/migrate-guest` | 3 | 1 hour | Guest data migration |

### Cookie Security Checklist

- [x] `httpOnly: true` — no JS access
- [x] `secure: true` — HTTPS only (prod)
- [x] `sameSite: 'lax'` — CSRF protection
- [x] `domain: '.gridlock.pro'` — scoped to our domain
- [x] `path: '/'` — available on all routes
- [x] 7-day expiry — reasonable session length

---

## 11. Test Plan (TDD)

Tests are written FIRST. Implementation follows tests.

### 11a. Backend Unit Tests (`backend/__tests__/auth.test.js`)

```
Auth Routes
  GET /api/auth/google
    ✓ redirects to Google with correct params
    ✓ encodes returnTo + CSRF in state parameter
    ✓ uses prompt=select_account and access_type=online
    ✓ validates returnTo param (rejects absolute URLs)
    ✓ rate limits after 10 requests

  GET /api/auth/google/callback
    ✓ decodes state, verifies CSRF, extracts returnTo
    ✓ exchanges code for tokens
    ✓ creates new user on first sign-in (usernameSetupComplete: false)
    ✓ finds existing user on repeat sign-in
    ✓ sets JWT cookie on success (sub + iat + exp only)
    ✓ redirects to /auth/setup for new users
    ✓ redirects to returnTo for existing users
    ✓ handles Google error (user denied)
    ✓ rejects invalid state (CSRF mismatch)
    ✓ handles token exchange failure
    ✓ updates lastLoginAt on existing user

  GET /api/auth/me
    ✓ returns user object when authenticated
    ✓ returns { user: null } when no cookie
    ✓ returns { user: null } when expired token
    ✓ returns { user: null } when user deleted (clears cookie)
    ✓ never returns 401

  POST /api/auth/logout
    ✓ clears JWT cookie
    ✓ returns 401 when not authenticated
    ✓ returns 403 when X-Requested-With header missing

  POST /api/auth/setup-username
    ✓ sets username and usernameSetupComplete: true
    ✓ catches MongoDB 11000 error → returns 409
    ✓ rejects reserved words
    ✓ rejects invalid characters
    ✓ rejects too short (< 2 chars)
    ✓ rejects too long (> 16 chars)
    ✓ returns 401 when not authenticated
    ✓ rejects if usernameSetupComplete already true
    ✓ returns 403 when X-Requested-With header missing

  POST /api/auth/migrate-guest
    ✓ migrates leaderboard data within transaction
    ✓ migrates ranked profile data
    ✓ migrates game history data
    ✓ migrates daily result data
    ✓ sets userId on migrated records
    ✓ only migrates records with userId: null
    ✓ rejects if already migrated
    ✓ rejects invalid guest username
    ✓ returns 401 when not authenticated
    ✓ returns 403 when X-Requested-With header missing

  DELETE /api/auth/account
    ✓ deletes user document
    ✓ nullifies userId on associated records
    ✓ clears JWT cookie
    ✓ returns 401 when not authenticated
    ✓ returns 403 when X-Requested-With header missing
```

### 11b. Middleware Tests (`backend/__tests__/authMiddleware.test.js`)

```
optionalAuth Middleware
  ✓ sets req.user when valid token present
  ✓ passes through when no cookie
  ✓ passes through when invalid token (clears cookie)
  ✓ passes through when user deleted (clears cookie)
  ✓ does not call next() twice

requireAuth Middleware
  ✓ sets req.user when valid token present
  ✓ returns 401 when no cookie
  ✓ returns 401 when invalid token
  ✓ returns 401 when user deleted
  ✓ clears stale cookies on auth failure

csrfHeader Middleware
  ✓ passes when X-Requested-With: XMLHttpRequest present
  ✓ returns 403 when header missing
  ✓ returns 403 when header has wrong value
```

### 11c. User Model Tests (`backend/__tests__/userModel.test.js`)

```
User Model
  ✓ creates user with valid data
  ✓ requires googleId
  ✓ requires email
  ✓ requires displayName
  ✓ requires username
  ✓ enforces unique googleId
  ✓ enforces unique email
  ✓ enforces unique username
  ✓ lowercases email
  ✓ trims whitespace from all string fields
  ✓ rejects username > 16 chars
  ✓ rejects username < 2 chars
  ✓ rejects username with invalid chars
  ✓ defaults usernameSetupComplete to false
  ✓ auto-sets createdAt and updatedAt via timestamps
  ✓ does not create duplicate indexes for unique fields
```

### 11d. Integration Tests

```
Auth + Existing Features Integration
  ✓ authenticated user's ranked game records userId
  ✓ guest ranked game records userId: null
  ✓ profile endpoint returns enhanced data for account owner
  ✓ leaderboard shows avatar + verified badge for authenticated users
  ✓ daily challenge enforces one attempt per userId+date (authenticated)
  ✓ daily challenge enforces one attempt per username+date (guests)
  ✓ DailyResult sparse unique index { date: 1, userId: 1 } works
  ✓ Socket.IO handshake extracts userId from cookie
```

### 11e. E2E Tests (`e2e/52-auth.spec.js`)

```
Authentication E2E
  Guest Play Regression
    ✓ guest can create and play a game without signing in
    ✓ guest can access leaderboard
    ✓ guest can play daily challenge
    ✓ guest can use all lobby features
    ✓ no auth UI blocks any game flow

  Sign In Flow (mocked Google)
    ✓ clicking avatar shows sign-in option
    ✓ settings page has sign-in section
    ✓ redirect to Google OAuth URL has correct params
    ✓ callback with valid code sets cookie and redirects
    ✓ avatar changes to profile picture after sign-in
    ✓ /auth/setup page allows username selection
    ✓ duplicate username shows 409 error on setup page

  Authenticated Features
    ✓ profile shows enhanced stats for signed-in user
    ✓ verified badge shows on leaderboard for authenticated users
    ✓ sign-out clears cookie and reverts to guest UI
    ✓ "Save progress" nudge shows for guests
    ✓ "Save progress" nudge hidden for authenticated users
    ✓ nudge dismissal persists for 7 days

  Account Management
    ✓ settings shows account section when signed in
    ✓ delete account confirmation modal works
    ✓ delete account clears all data and signs out
```

---

## 12. Deployment & Rollback

### Environment Variables to Add

```bash
# Production (.env on EC2)
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">

# Beta (.env — separate JWT secret for environment isolation)
GOOGLE_CLIENT_ID=<same or separate Google project>
GOOGLE_CLIENT_SECRET=<same or separate>
JWT_SECRET=<different value from production>
```

### CORS Update

Add `credentials: true` to both Express and Socket.IO CORS config:

```javascript
// Express CORS
app.use(cors({
  origin: function(origin, callback) { /* existing logic */ },
  credentials: true,  // ← Required: allow cookies cross-origin
}));

// Socket.IO CORS (in server.js where io is created)
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) { /* same origin logic */ },
    credentials: true,  // ← Required: allow cookies on WebSocket handshake
  },
});
```

### Deployment Steps

1. Add env vars to production `.env`
2. `npm install google-auth-library jsonwebtoken cookie-parser` in backend
3. Deploy backend via `scripts/deploy-backend.sh`
4. Deploy frontend via `scripts/deploy-frontend.sh`
5. Run smoke test: `bash scripts/smoke-test.sh https://api.gridlock.pro`
6. Verify: `curl -s https://api.gridlock.pro/api/auth/me` returns `{ "success": true, "user": null }`

### Rollback Plan

Auth is purely additive. Rollback = deploy previous version. No data migration to undo.

- Old frontend doesn't have AuthContext → no auth UI → works fine
- Old backend doesn't have `/api/auth/*` routes → 404 → no impact
- `userId` fields on existing models have `default: null` → ignored by old code
- JWT cookies are httpOnly → old frontend can't even see them → no conflict

---

## 13. File Change Manifest

### New Files

```
backend/routes/auth.js                    — OAuth routes
backend/middleware/auth.js                — optionalAuth + requireAuth + csrfHeader
backend/config/authConfig.js              — Google OAuth config, JWT config, reserved usernames
backend/__tests__/auth.test.js            — Auth route tests
backend/__tests__/authMiddleware.test.js  — Middleware tests (incl. csrfHeader)
backend/__tests__/userModel.test.js       — User model tests
frontend/src/contexts/AuthContext.jsx     — Auth state provider (global axios config)
frontend/src/components/AuthAvatar.jsx    — Top-right avatar/sign-in button
frontend/src/components/AuthSetup.jsx     — Username selection page (post-first-sign-in)
frontend/src/components/AuthNudge.jsx     — "Save your progress" dismissable banner
e2e/52-auth.spec.js                       — E2E auth tests
```

### Modified Files

```
backend/models/User.js                    — Rewrite: OAuth fields, remove password, timestamps: true
backend/models/Leaderboard.js             — Add optional userId field
backend/models/RankedProfile.js           — Add optional userId field
backend/models/GameHistory.js             — Add optional userId field
backend/models/DailyResult.js             — Add optional userId field + sparse unique index { date: 1, userId: 1 }
backend/server.js                         — Add cookie-parser, auth routes, CORS credentials (Express + Socket.IO)
backend/package.json                      — New deps: google-auth-library, jsonwebtoken, cookie-parser
backend/.env.example                      — Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET
backend/config/corsOrigins.js             — No change (origins already correct)
frontend/src/App.jsx                      — Wrap with AuthProvider, add /auth/setup route, add AuthAvatar
frontend/src/components/Settings.jsx      — Add Account section
frontend/src/components/BottomNav.jsx     — No change
e2e/helpers.js                            — Add auth helper utilities for E2E
```

### NOT Changed (Intentional)

```
backend/controllers/socketHandlers.js     — Phase 1 does NOT change game logic
backend/controllers/handlers/*.js         — Game handlers stay untouched
frontend/src/components/Board.jsx         — Game board unchanged
frontend/src/components/Lobby.jsx         — Lobby unchanged (username still from localStorage for guests)
frontend/src/socket.js                    — Socket connection unchanged in Phase 1
```

---

*This document is the implementation-ready spec for GridLock authentication. All design decisions are final.*
