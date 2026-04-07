# UI/UX Audit: GridLock (Desktop Light Mode)

## 01: Lobby

**Description:**
The lobby screen features a clean, minimalist layout with a top navigation bar (Lobby, Leaderboard, History, Rules, Settings). A prominent hero section displays the game title "GridLock" with a subtitle "MULTIPLAYER • 2-4 PLAYERS". Below, a modal-like card contains a welcome message, a small 2x2 game grid preview, and player score display "You 0 vs Alex 0". Action elements include a text input "Enter your name" and a blue "Play Now" button. A dismissible banner at the top offers a quick tutorial.

**Strengths:**
- **Clear Hierarchy:** The title and primary call-to-action ("Play Now") are prominent and well-spaced.
- **Intuitive Flow:** The "Enter your name" field followed by "Play Now" is a natural, sequential step for new users.
- **Visual Cueing:** The small grid preview effectively communicates the core game mechanic without overwhelming the user.
- **Consistency:** Colors and typography are consistent across the header and action buttons.

**Issues:**
- **Ambiguous Player Name Input:** The "Enter your name" field is vague. Does it require a unique username, or can it be any display name? Is it saved? This needs clarification. 🟡
- **Lack of User Feedback:** No indicator of input validation (e.g., minimum/maximum characters, prohibited symbols). 🟢
- **Weak Secondary Action:** The "New to GridLock?" banner is dismissible but offers no clear value proposition or benefit for clicking. The "Learn the rules in 2 minutes" is too generic. 🟡
- **Inconsistent Iconography:** The settings gear icon is plain, while the user profile icon is a stylized avatar. This inconsistency breaks visual harmony. 🟢
- **Low Contrast for Inactive Tabs:** The "Leaderboard," "History," and "Rules" tabs are greyed out but lack sufficient contrast against the light background, making them hard to read for users with visual impairments. 🟡

**Recommendations:**
1. Clarify the player name input field with placeholder text like "Choose your display name (e.g., 'DJ_87')" and add a tooltip or helper text explaining if the name is public or unique. (Severity: 🟡)
2. Add real-time validation feedback to the name input field (e.g., green checkmark for valid, red exclamation for invalid). (Severity: 🟢)
3. Enhance the tutorial banner with a more compelling CTA like "Learn the rules → Win your first game in 2 minutes!" and a clear benefit. (Severity: 🟡)
4. Standardize icons: use a consistent style (e.g., all line icons or all filled icons) for the header, including the settings and user profile icons. (Severity: 🟢)
5. Increase the contrast of inactive tab text (e.g., use #6C757D for inactive vs. #343A40 for active) to meet WCAG AA standards. (Severity: 🟡)

---

## 02: Leaderboard

**Description:**
The leaderboard is a data-heavy screen with a clear title "Leaderboard" and a subtitle "Top GridLock players by wins, win rate, then ELO". It has toggle buttons for "Casual" and "Ranked" modes. A "Find a Player" search bar with a "Search" button is prominently placed. The main content is a table listing players with columns for Rank, Player, W/L/D, Win Rate, ELO, and Last Played.

**Strengths:**
- **Effective Information Display:** The table format is ideal for comparing players with clear column headers and consistent data alignment (right-aligned numbers, left-aligned text).
- **Strong Visual Hierarchy:** The top 3 players are highlighted with distinct cards, drawing immediate attention.
- **Actionable Navigation:** The "Casual"/"Ranked" toggle and "Find a Player" search allow for quick filtering.
- **Useful Metadata:** The "Ranked by ELO. Ties broken by total games played." note at the bottom provides essential context for understanding the ranking logic.

**Issues:**
- **Confusing Toggle Design:** The "Casual" and "Ranked" buttons lack visual feedback on which is currently selected. There's no clear indication of the active state. 🟡
- **Inconsistent Typography:** The "Top GridLock players by wins, win rate, then ELO" subtitle uses a smaller, lighter font than the main title, but its placement and lack of visual separation make it feel like part of the title, reducing its perceived importance. 🟢
- **Weak Search Button:** The "Search" button next to the "Find a Player" input is blue, but its size and lack of visual weight make it feel less important than the search field. It should be more prominent. 🟡
- **No Error State for Search:** If a user searches for a non-existent player, there is no visual feedback. The screen remains static, which can be confusing. 🟡
- **Redundant Header:** The "Rank #1," "Rank #2," and "Rank #3" labels on the top cards are redundant since the rank is already displayed in the table. This adds unnecessary clutter. 🟢

**Recommendations:**
1. Add a visual indicator (e.g., a darker background or underline) to the active "Casual"/"Ranked" toggle to clearly show the user's selection. (Severity: 🟡)
2. Give the subtitle more visual separation and weight (e.g., increase font size slightly and add a bottom border) to make it more readable and distinct from the main title. (Severity: 🟢)
3. Make the "Search" button more prominent by increasing its size to match the search input height and adding a bold, filled style. (Severity: 🟡)
4. Implement a clear error state for the search function. If no results are found, display a message like "No players found. Try a different username." below the search bar. (Severity: 🟡)
5. Remove the redundant "Rank #1," "Rank #2," and "Rank #3" labels from the top cards. The rank is already visible in the table; these labels only add visual noise. (Severity: 🟢)

---

## 03: History

**Description:**
The History screen is minimalist, with a title "Game History" and a subtitle "Browse your past games with ELO changes". It features a single search field labeled "LOOK UP PLAYER" with a placeholder "Enter username" and a "Search" button. Below, a placeholder message reads "Enter a username above to view game history.".

**Strengths:**
- **Simplicity:** The screen is uncluttered and focuses the user's attention on the primary task: searching for a player's history.
- **Clear Instruction:** The placeholder text and the placeholder message below it provide clear instructions on how to use the screen.
- **Consistent Design:** The "Search" button and input field follow the same design pattern as the Leaderboard screen, maintaining design consistency.

**Issues:**
- **Empty State is Too Vacant:** The screen feels incomplete and potentially broken because it lacks any visual feedback or content when no search has been performed. The placeholder message is too minimal and doesn't guide the user on what to expect. 🟡
- **Lack of Recent Activity:** For a user's own history, it would be beneficial to show recent games or popular players by default. The current empty state does not encourage exploration. 🟡
- **No Search History:** The input field does not store or suggest previous searches, which is a common and helpful feature for users looking up multiple players. 🟢
- **Ambiguous Search Scope:** It's unclear if "LOOK UP PLAYER" searches for the current user's own history or any player's history. The label should be more specific (e.g., "Look up your history" or "Search player's history"). 🟡

**Recommendations:**
1. Enhance the empty state by adding a more engaging placeholder. For example, "No game history yet? Play your first game to start tracking your ELO changes!" or a list of "Recently Active Players" with "View History" links. (Severity: 🟡)
2. Implement a "Recent History" section for the logged-in user that shows their last 5 games with date, opponent, and result, encouraging them to explore their own performance. (Severity: 🟡)
3. Add a search history feature that displays the last 3-5 searched usernames below the input field, allowing for quick re-search. (Severity: 🟢)
4. Update the label to be more precise: change "LOOK UP PLAYER" to "Look up your game history" for the user's own history or "Search for a player's history" for a general search. The context should guide the label. (Severity: 🟡)

---

## 04: Rules

**Description:**
The Rules page is a long-form content page with a title "How to Play GridLock — Dots & Boxes Online". It is divided into sections: "GridLock Rules," "Game Modes," "GridLock Strategy Tips," "Grid Sizes," and "Features." Each section uses icons, headings, and descriptive text. The page ends with a prominent "Start a Game Now" button.

**Strengths:**
- **Comprehensive Content:** The page covers every aspect of the game, from basic rules to advanced strategy and features, making it a valuable resource.
- **Structured Layout:** The use of clear headings, icons, and bullet points makes the dense information scannable and digestible.
- **Action-Oriented Close:** The "Start a Game Now" button at the bottom provides a clear next step, converting education into action.
- **Visual Reinforcement:** Icons next to each heading (e.g., a pencil for "Draw a line") effectively reinforce the text and improve memorability.

**Issues:**
- **Overwhelming Length:** The page is very long and can be intimidating for new users. There is no "Quick Start" section or collapsible sections for different levels of detail. 🟡
- **Inconsistent Icon Size:** The icons used for sections (e.g., the "Game Modes" section) vary in size and style, which can feel unpolished and reduce professional quality. 🟢
- **Link Ambiguity:** Several terms (e.g., "CPU Opponents," "Ranked Mode") are used but not linked to their descriptions or glossary, forcing users to scan the entire page for explanation. 🟡
- **Lack of Interactive Demo:** For a game, static rules are less effective than an interactive tutorial. A simple, embedded 1-2 move tutorial would greatly enhance learning. 🟡
- **No Progress Feedback:** There is no way for a user to track how much of the rules they have read, which can be demotivating for those who want to ensure they've learned everything. 🟢

**Recommendations:**
1. Add a "Quick Start" section at the top that summarizes the 3-5 most critical rules in under 100 words, followed by a "Read Full Rules" link for users who want more detail. (Severity: 🟡)
2. Standardize all section icons to a uniform size and style (e.g., 24x24px, consistent stroke weight) to create a polished, professional look. (Severity: 🟢)
3. Implement in-text linking for key terms. For example, make "CPU Opponents" a link that anchors to the "Game Modes" section, allowing users to quickly jump to the detailed explanation. (Severity: 🟡)
4. Embed a simple, interactive tutorial widget (e.g., a 3-step slideshow that lets users tap to complete a box) to demonstrate the core mechanic, making the rules more engaging and memorable. (Severity: 🟡)
5. Add a progress bar or checkmark system at the top of the page (e.g., "You've reviewed 2 of 5 sections") to provide a sense of accomplishment and encourage users to read the entire guide. (Severity: 🟢)

---

## 05: Settings

**Description:**
The Settings screen is organized into sections: Account, Preferences, Grid Theme, and Session Stats. The Account section has a "Sign in with Google" button. Preferences include toggles for "Light Mode," "Sounds On," and "Push Notifications." Grid Theme displays six theme options (Clean, Classic, Minimal, Neon Glow, Glassmorphism) with unlock conditions. Session Stats show a dropdown with "Your Stats" and a note "No games played yet."

**Strengths:**
- **Clear Sectioning:** The layout is logically divided into distinct sections (Account, Preferences, Theme, Stats), making it easy for users to find settings.
- **Effective Visual Feedback:** The active theme ("Clean") is clearly highlighted with a border and "✓ Active" label.
- **Gamification:** The unlock conditions (e.g., "Win 10 games") for themes add a fun, motivational element to the game.
- **Progressive Disclosure:** The "Session Stats" section uses a dropdown to hide detailed stats, keeping the interface clean.

**Issues:**
- **Confusing Toggle Logic:** The "Light Mode" toggle is shown as "ON" (blue), but the text says "Tap to switch to dark theme." This is confusing because a toggle should reflect its current state, not the action. 🟡
- **Inconsistent Toggle Design:** The "Sounds On" toggle has a downward arrow, suggesting it opens a menu, but it behaves as a simple on/off toggle. This inconsistency can confuse users. 🟡
- **Unresponsive Element:** The "Session Stats" dropdown shows "Your Stats" but has no content when "No games played yet." A more helpful message would be "Your stats will appear here after your first game!" or a button to "Start a Game." 🟡
- **Weak Unlock Feedback:** There's no visual indication of how close a user is to unlocking a theme. For example, for "Win 10 games," it would be better to show a counter like "2/10 games won" next to the theme. 🟢
- **Missing Confirmation:** When a user changes a setting (e.g., switches theme), there is no visual or auditory confirmation (e.g., a sound or brief animation) to confirm the change. 🟢

**Recommendations:**
1. Fix the "Light Mode" toggle behavior: when enabled, the toggle should say "Light Mode" and the text should read "Tap to switch to dark mode." When disabled, it should say "Dark Mode" with the text "Tap to switch to light mode." The toggle label should reflect the current state, not the action. (Severity: 🟡)
2. Remove the downward arrow from the "Sounds On" toggle. If it needs to open a menu, change it to a "Settings" icon or a three-dot menu. If it's a simple toggle, it should look and behave like one (binary on/off state). (Severity: 🟡)
3. Enhance the "Session Stats" dropdown with a more engaging message. Replace "No games played yet" with "Get started! Your stats will appear here after your first game. Ready to play?" and link "Ready to play?" to the Lobby. (Severity: 🟡)
4. Add a progress indicator for locked themes. For example, near the "Minimal" theme, display "3/10 games won" or a small progress bar to show users how close they are to unlocking it. (Severity: 🟢)
5. Add a subtle visual or auditory cue (e.g., a small "check" animation or a soft "ding" sound) when a setting is successfully changed to provide immediate feedback to the user. (Severity: 🟢)