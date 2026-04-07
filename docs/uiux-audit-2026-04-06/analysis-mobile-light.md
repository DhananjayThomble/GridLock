# GridLock UI/UX Audit - Mobile Light Mode (2026-04-06)

## 1. Lobby Screen (/01-lobby.png)

**Description:**
- Header with "GridLock" logo and user avatar icon.
- Prominent banner: "New to GridLock? Learn the rules in 2 minutes →" with close button.
- Main card with game description "Welcome! Complete boxes to win." and mini game board example (2x2 grid).
- Player names "You" (blue) vs "Alex" (orange) with score 0-0.
- Input field "Enter your name" with rounded corners.
- Large blue "Play Now" button with play icon.
- Footer navigation: Lobby, Leaderboard, Rules, History, Settings with icons.
- Attribution "GridLock · Made with ❤️ by DJ" at bottom.

**Strengths:**
- Clear visual hierarchy: primary action (Play Now) is prominent, descriptive text is scannable.
- Good use of color: brand purple/blue for primary actions, contrasting player colors.
- Simple, focused layout with minimal distractions.
- Helpful onboarding banner for new users.
- Consistent iconography in footer.

**Issues:**
- 🔴 **Critical**: "Play Now" button is too small for mobile thumb reach (estimated ~32px height — below 44px recommended). Risk of misclicks.
- 🟡 **Medium**: "Enter your name" field lacks placeholder text styling guidance (no hint color, no border focus state shown).
- 🟡 **Medium**: Player name display "You vs Alex" is ambiguous — is Alex the opponent or a dummy name? Should clarify "Waiting for opponent" or "Play vs Alex".
- 🟢 **Minor**: Banner close icon is small (estimated ~16px) — could be larger for easier dismissal.
- 🟢 **Minor**: Attribution text at bottom is very small — hard to read on mobile.

**Recommendations:**
1. Increase "Play Now" button height to 48-56px to meet mobile touch target standards.
2. Add placeholder text styling: light gray hint text "Your name" with focused border.
3. Clarify player status: change "You vs Alex" to "You (0) vs Alex (0) — Waiting for opponent" or "Play vs Alex" if pre-set.
4. Expand banner close icon to 24px with padding.
5. Increase attribution font size to 12px and ensure contrast ratio > 4.5:1.

---

## 2. Leaderboard Screen (/02-leaderboard.png)

**Description:**
- Header with "Leaderboard" title, trophy icon, and toggle between "Casual" and "Ranked".
- Search section "FIND A PLAYER" with input field "Search username" and blue "Search" button.
- Scrollable list of players ranked #1 to #20 with: Rank, Username, ELO/Wins/Losses/Win Rate, and score.
- Each row has avatar (if any), username, stats, and score in separate columns.
- Footer navigation with active "Leaderboard" highlighted.

**Strengths:**
- Clear sorting and filtering: "Casual"/"Ranked" toggle is visible and easy to tap.
- Good data density: player stats are compact yet readable with icons (thumbs up/down for wins/losses).
- Consistent column alignment improves scanability.
- Search box is intuitive with clear label and action button.
- Responsive layout: scales well vertically for long lists.

**Issues:**
- 🔴 **Critical**: Search input lacks clear focus state — no visual indicator when active, increasing risk of mistyping.
- 🔴 **Critical**: Player rows are too dense — touch targets for tapping a single row are cramped (estimated row height ~40px, padding minimal). Risk of tapping wrong player.
- 🟡 **Medium**: ELO/Wins/Losses/Win Rate text is small (≈12px) — hard to read on small screens.
- 🟡 **Medium**: No visual feedback when "Search" button is pressed (e.g., loading spinner or button state change).
- 🟢 **Minor**: Rank numbers ("#1", "#2") are not consistently spaced — some have extra space.
- 🟢 **Minor**: No "Back to top" button or sticky header during long scroll.

**Recommendations:**
1. Increase row height to 56px with 8px padding between rows to isolate touch targets.
2. Add focus state to search field: blue border and slight glow when active.
3. Increase stats text size to 14px and use bold for ELO/Score numbers.
4. Add loading spinner to "Search" button on tap to indicate processing.
5. Add sticky header or "Back to top" button for long scroll.

---

## 3. History Screen (/03-history.png)

**Description:**
- Header with "Game History" title and scroll icon.
- Subtitle: "Browse your past games with ELO changes".
- Section "LOOK UP PLAYER" with input field "Enter username" and blue "Search" button.
- Empty state message: "Enter a username above to view game history.".
- Footer navigation with "History" active.

**Strengths:**
- Clear empty state: instructs user exactly what to do next.
- Simple, uncluttered design focused on core task.
- Consistent search pattern from Leaderboard.
- Good use of space with minimal visual noise.

**Issues:**
- 🟡 **Medium**: Input field "Enter username" lacks placeholder styling — no hint color or focused state.
- 🟡 **Medium**: Empty state message is passive — could be more proactive (e.g., "No history yet. Play a game to see your stats!").
- 🟢 **Minor**: Search button icon (magnifying glass) is missing — users expect visual cue.
- 🟢 **Minor**: No clear "Cancel" or "Clear" option for the search field.

**Recommendations:**
1. Add placeholder text "Enter username" in light gray and focused border.
2. Rewrite empty state: "No games played yet. Play now to see your history!" with a link to Lobby.
3. Add magnifying glass icon to "Search" button.
4. Add "X" clear button inside search field on focus.

---

## 4. How to Play Screen (/04-how-to-play.png)

**Description:**
- Long scrollable page with sections: "GridLock Rules", "Game Modes", "GridLock Strategy Tips", "Grid Sizes", "Features", "Ready to Play GridLock?".
- Each section has header, icon, and bullet points.
- "Game Modes" lists Online Multiplayer, CPU Opponents, Quick Play, Ranked Mode.
- "Strategy Tips" gives 6 tips (Control the Center, Double-Cross, etc.).
- "Grid Sizes" compares 3x3 to 6x6 with icons.
- "Features" lists 5 features (Spectator Mode, 3 Dark & Light Themes, etc.).
- Footer CTA "Start a Game now →" button.

**Strengths:**
- Excellent information architecture: logical flow from rules → modes → tips → sizes → features.
- Good use of icons to break up text and aid comprehension.
- Consistent typography hierarchy: clear headers, readable body text.
- Comprehensive coverage of game depth without overwhelming.
- Mobile-optimized: vertical scroll works for long content.

**Issues:**
- 🟡 **Medium**: No "Back" button or header — users can’t easily return to Lobby without swipe or nav bar.
- 🟡 **Medium**: Strategy tips section is text-heavy — could use diagrams or icons for each tip.
- 🟢 **Minor**: "Start a Game now →" button is small (≈36px height) — increase to 48px.
- 🟢 **Minor**: No progress indicator for long scroll — users may not realize how much content exists.
- 🟢 **Minor**: Font size for "GridLock Rules" header is small relative to other section headers.

**Recommendations:**
1. Add sticky header with "Back" button (left arrow) to navigate back to Lobby.
2. Add small illustrative icons or diagrams beside each strategy tip (e.g., grid snippet for "Control the Center").
3. Increase "Start a Game now →" button height to 48px and add padding.
4. Add a subtle scroll progress bar at top or bottom.
5. Increase header font size for "GridLock Rules" to match other section headers.

---

## 5. Settings Screen (/05-settings.png)

**Description:**
- Header with "Settings" title.
- Account section: "Sign in with Google" with "Sign In" button.
- Preferences: Light Mode toggle, Sounds On toggle, Push Notifications toggle with help text.
- Grid Theme section: 4 theme options (Clean, Classic, Minimal, Neon Glow, Glassmorphism) with unlock conditions.
- Session Stats: "Your Stats" with "No games played yet" and dropdown.
- Footer navigation with "Settings" active.

**Strengths:**
- Clear categorization: Account, Preferences, Theme, Stats.
- Good toggle design: large, visible switches with labels.
- Theme preview icons are clear and differentiated.
- Unlock conditions provide incentive to play more.
- Consistent footer navigation.

**Issues:**
- 🔴 **Critical**: "Sign In" button is too small (≈32px height) — hard to tap on mobile.
- 🔴 **Critical**: Theme selection grid is too dense — touch targets are small (≈40x40px) and close together, risk of wrong selection.
- 🟡 **Medium**: Push Notifications toggle label is misleading — "Set a username in the lobby first" is a prerequisite, not a toggle function.
- 🟡 **Medium**: No visual feedback when theme is selected (e.g., "Active" badge only on Clean — should show on all selected).
- 🟢 **Minor**: "Session Stats" dropdown arrow is small — hard to tap.
- 🟢 **Minor**: No "Save" or "Apply" button — changes appear instant, but users may expect confirmation.

**Recommendations:**
1. Increase "Sign In" button height to 48px and add padding.
2. Increase theme tile size to 64x64px with 16px padding between tiles.
3. Reword Push Notifications label: "Enable notifications — set username in Lobby first".
4. Add "Active" badge to the currently selected theme, not just "Clean".
5. Increase dropdown arrow size and add touch padding.
6. Add "Save" button at bottom for preference changes to provide user control.