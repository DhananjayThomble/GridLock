# GridLock Mobile Dark Mode UI/UX Audit - 2026-04-06

This is a professional, expert-level audit of the GridLock mobile interface in dark mode. Each of the 5 provided screenshots is analyzed for layout, strengths, issues (rated for severity), and actionable recommendations. Special attention is paid to mobile-specific concerns like touch targets, thumb reach, and readability.

---

## 1. Lobby Screen (01-lobby.png)

**Description:**
The lobby screen serves as the primary entry point. It features a dark background with purple and blue accents. A welcome message explains the game goal: "Complete boxes to win." A small 2x2 game board preview is shown for context. Below are input and action areas: a text field "Enter your name" and a prominent blue "Play Now" button. A banner for new users offers a 2-minute rule overview. The bottom navigation bar contains 5 icons: Lobby, Leaderboard, Rules, History, and Settings.

**Strengths:**
- **Clear Visual Hierarchy:** The primary CTA "Play Now" is the most prominent element, guiding the user to the next step.
- **Onboarding Clarity:** The "New to GridLock?" banner is non-intrusive and provides value for first-time users.
- **Consistency:** The color scheme (dark background, blue/purple accents) is consistent and readable in dark mode.
- **Responsive Layout:** The layout appears to scale well, with elements not crowding the small screen.

**Issues:**
- **Touch Target Size (🟡 Medium):** The "Enter your name" input field is slightly narrow (appears <44px tall). Mobile inputs should have a minimum height of 44px for thumb-friendly tapping. This could cause mis-taps.
- **Info Density (🟡 Medium):** The "Your turn" and "You 0 vs Alex 0" text is small and feels crowded above the game preview. This is the core game state, which needs higher prominence.
- **Missing Affordance (🟡 Medium):** The user icon in the top-right corner has no visual cue (like a dropdown arrow or tap state) to indicate it's interactive. Users may not realize it's an account menu.
- **Accessibility (🟢 Minor):** The "Learn the rules in 2 minutes" link has low contrast against the dark banner. It should be bolded or given a brighter accent color for better readability.

**Recommendations:**
1. Increase the height of the "Enter your name" input to at least 44px. 
2. Increase the font size and weight of the game state text ("Your turn", "You 0 vs Alex 0") by 20% to make it more readable at a glance.
3. Add a small downward arrow or highlight color to the top-right user icon to indicate interactivity.
4. Change the "Learn the rules" link text to a brighter purple or blue to improve contrast against the banner background.
---

## 2. Leaderboard Screen (02-leaderboard.png)

**Description:**
This screen displays the global leaderboard. It has a "Casual" vs "Ranked" toggle at the top, followed by a "Search" field. The list shows player names, their ELO scores, win rates, and game counts. Each row includes a player's rank, name, ELO, stats, and their current position in the leaderboard (e.g., #3, #10). The background is dark with white/grey text, and blue for interactive elements (buttons, ranks).

**Strengths:**
- **Excellent Information Architecture:** The data is presented logically with clear column headers (Rank, ELO, WR) that users can scan.
- **High Readability:** The contrast between white text and dark background is optimal for dark mode.
- **Consistent Interaction:** The "Casual"/"Ranked" toggle is well-designed and clearly indicates the current state.
- **Mobile-Sized Touch Targets (🟢 Minor):** The "Search" button and toggle switches are large enough for easy tapping.

**Issues:**
- **Thumb-Reach (🟡 Medium):** The "Search" field and toggle are positioned at the top of the screen, which is hard to reach with one hand on large phones. Move these to the bottom, above the nav bar, or add a floating action button for "Search".
- **Missing Scrolling Clues (🔴 Critical):** There is no visual indication (like a scrollbar or fading edge) that the list is scrollable. Users on mobile may assume they are seeing the entire list and not scroll down.
- **Column Width (🟡 Medium):** The "Rank" column (e.g., #1, #3) is too narrow, making it hard to read at a glance. Increase its width to 15% of the screen.
- **Empty State (🟢 Minor):** If a user searches and finds no results, the screen displays an empty list with no message. Add a placeholder: "No players match 'X'. Try a different name."

**Recommendations:**
1. Move the "Search" field and "Casual"/"Ranked" toggle to the bottom of the screen, just above the navigation bar, to improve thumb reach.
2. Add a subtle, semi-transparent scrollbar on the right edge of the list, or a fading gradient at the bottom to indicate more content exists.
3. Increase the width of the "Rank" column to ensure ranks are clearly visible.
4. Implement an empty state message for search: "No results found. Try a different username."
---

## 3. History Screen (03-history.png)

**Description:**
The history screen is minimal. It has a large "Game History" title with a scroll icon, and a subtitle: "Browse your past games with ELO changes." Below is a "Look Up Player" section with a text input for username and a "Search" button. There is also a static prompt: "Enter a username above to view game history."

**Strengths:**
- **Simplicity:** The screen is uncluttered and focused on one task: looking up game history.
- **Clear Action:** The "Search" button provides a clear next step.
- **Consistent Typography:** The font and spacing are consistent with other screens.

**Issues:**
- **Critical UX Flow (🔴 Critical):** There is no way to view *your own* history without typing your username. This is a core use case for "Game History" and should be a default view (e.g., "My Games" tab or a "View My History" button). Users expect to see their own history first.
- **Touch Target Size (🟡 Medium):** The "Search" button is tall but appears slightly narrow. Ensure it meets the 44px minimum width for touch targets.
- **Visual Clutter (🟢 Minor):** The static text "Enter a username above to view game history." is redundant. The "Look Up Player" label is sufficient.
- **Missing Loading State (🟢 Minor):** When a user clicks "Search," there is no loading indicator. Add a spinner to prevent users from spamming the button.

**Recommendations:**
1. Add a "My Games" tab or button next to "Look Up Player" to show the current user's history by default.
2. Increase the width of the "Search" button to 44px.
3. Remove the static text "Enter a username above to view game history." to reduce visual noise.
4. Add a loading spinner next to the "Search" button that appears when clicked and disappears on result load.
---

## 4. How to Play Screen (04-how-to-play.png)

**Description:**
This screen is a long-scrolling page explaining the game rules. It starts with a title "How to Play GridLock — Dots & Boxes Online" and a 3-step visual guide (Draw, Claim, Chain). Below are sections: "Game Modes" (Online Multiplayer, Tournaments, Quick Play, etc.), "GridLock Strategy Tips" (with 5 tips), "Grid Sizes" (3x3, 4x4, 5x5, 6x6), and "Features" (Spectator Mode, Game Replay, etc.). A "Start a Game Now" button is at the bottom.

**Strengths:**
- **Comprehensive Content:** Covers all essential game rules and features in one place.
- **Visual Breakdown:** The 3-step graphic (Draw, Claim, Chain) is simple and effective for onboarding.
- **Scannable Structure:** Sections are well-organized with icons and headings for easy skimming.
- **Strong CTA:** The "Start a Game Now" button at the bottom provides a clear exit point.

**Issues:**
- **Scrolling Confusion (🔴 Critical):** The page is extremely long, but there is no visual indicator that it scrolls (no scrollbar, no fading edge). New users may not realize they can scroll and miss half the content.
- **Touch Target Size (🟡 Medium):** The icons for "Game Modes" and "Strategy Tips" are small (appears 32px). Increase to 44px for better tap accuracy.
- **Content Density (🟡 Medium):** The "Features" section is too text-heavy. Consider breaking it into an accordion or "Learn More" expandable section.
- **Missing Progress (🟢 Minor):** The screen has no "Page X of Y" or progress indicator. Users may feel lost in the long content.

**Recommendations:**
1. Add a subtle vertical scrollbar or a fading gradient at the bottom of the screen to indicate more content.
2. Increase the size of all icons (Game Modes, Strategy Tips, Grid Sizes) to 44px.
3. Convert the "Features" section into an expandable accordion or collapse it under a "Show More" button.
4. Add a progress bar or page counter (e.g., "Page 1/5") at the top to help users track their position.
---

## 5. Settings Screen (05-settings.png)

**Description:**
The settings screen is divided into sections: Account (Sign in with Google), Preferences (Dark Mode, Sounds On, Push Notifications), Grid Theme (Clean, Classic, Minimal, Neon Glow, Glassmorphism), and Session Stats (Your Stats). Each section has clear labels and toggle switches. The bottom navigation bar is visible at the bottom.

**Strengths:**
- **Logical Grouping:** Settings are categorized into clear sections (Account, Preferences, Grid Theme).
- **Excellent Toggle Design:** The toggle switches are large, clear, and have a consistent color scheme.
- **Theming Preview:** The Grid Theme section shows a small preview of each theme with its name, which is very user-friendly.
- **Consistent Spacing:** The spacing between sections and elements is uniform and professional.

**Issues:**
- **Thumb Reach (🟡 Medium):** The "Sign in with Google" button and toggle switches are positioned at the top of the screen. This is hard to reach with one hand. Move the "Sign in" button to the bottom, and group toggles closer to the user's thumb.
- **Disabled State (🟢 Minor):** The "Push Notifications" toggle is shown as off, but there's no explanation of why (e.g., "Set a username first"). Add a tooltip or helper text when the user hovers over it.
- **Missing Save (🟢 Minor):** Changes to Grid Theme appear to apply instantly. Add a "Save" or "Apply" button for all settings to give users control and reduce accidental changes.
- **Content Density (🟢 Minor):** The "Session Stats" section is very basic. Consider adding more stats (e.g., games won, rank, streak) or move it to a dedicated "Profile" screen.

**Recommendations:**
1. Move the "Sign in with Google" button to the bottom of the screen, below the "Session Stats" section.
2. Add a helper text or tooltip to the "Push Notifications" toggle: "Enable by setting a username in the Lobby first."
3. Add a "Save Settings" button at the bottom of the screen to apply changes only when the user is ready.
4. Expand the "Session Stats" section or move it to a new "Profile" screen to show more meaningful user data.

---

## Overall Recommendations

1. **Add Scrolling Indicators:** For all long-scrolling screens (Leaderboard, How to Play, Settings), add a subtle scrollbar or fading gradient to indicate more content.
2. **Optimize for Thumb Reach:** Move critical actions (Search, Sign In, Toggles) to the bottom of the screen or center them for easier one-handed use.
3. **Increase Touch Target Sizes:** Ensure all interactive elements (buttons, inputs, icons) are at least 44px tall and wide.
4. **Improve Empty States:** Add helpful messages for empty lists or failed searches.
5. **Enhance Accessibility:** Increase contrast for links and key game-state text, and add tooltips for disabled features.
6. **Consistent Navigation:** Keep the bottom navigation bar consistent across all screens for easy access to core features.

This audit identifies critical mobile-specific issues that, if fixed, will significantly improve the user experience, reduce frustration, and make GridLock more accessible and intuitive on mobile devices.