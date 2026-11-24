# Build a real-time Dots & Boxes game

This walkthrough traces a GridLock match from the first line to the replay. Follow it with a local checkout and two browser sessions. You’ll see how GridLock keeps the two boards in sync and how to verify a change at the rules, browser, and deployment layers.

## 1. Run a two-player match

Start MongoDB, the backend, and the frontend using the [local setup guide](CONTRIBUTING.md#local-setup). Open the game in two independent browser sessions, such as a normal window and a private window. Create a 3×3 two-player room in the first session, then join using its code in the second one. Draw three sides of a box across successive turns. When either player draws the fourth side, check that both boards show the new owner, that player gains a point, and their turn continues.

A 3×3 board has 9 boxes and 24 edges. Each edge belongs to at most two boxes, so checking a move only requires looking at those neighbors.

## 2. Implement the rules as a state transition

Open [the game rules](backend/utils/gameLogic.js). To build a minimal version, start with a 2×2 board. Store horizontal edges in a 3×2 array, vertical edges in a 2×3 array, and box owners in a 2×2 array. Initialize them to `null`, give each player a score of zero, and start with player one.

For each move, check the orientation-specific bounds and reject any occupied edge. Mark the edge with the current player’s ID, then check the one or two neighboring boxes. Give that player a point for each newly completed box. Advance to the next player only when the move closes zero boxes. Once the scores add up to the number of boxes, compare them to decide the winner or declare a draw.

Try closing two adjacent boxes with their shared edge. The result should add two points while keeping the same player’s turn. Compare your implementation with `calculateNewState` and the [backend tests](backend/__tests__/).

## 3. Put the server in charge of moves

Follow `make_move` in the [Socket.IO move handler](backend/controllers/handlers/moveHandler.js) and the line controls in the [React board](frontend/src/components/Board.jsx). The browser sends an edge coordinate. The server validates the payload and checks whose turn it is before applying the rules and broadcasting the updated state. Both clients can render the resulting board from the same state.

Try selecting an edge from the browser that is waiting for its turn. Check that the move is unavailable in the UI and that backend coverage exercises invalid moves independently of the UI. Treat the browser preview and hover states as feedback. The authoritative score, owner, and turn come from the server.

## 4. Record moves, replay them, and share the result

The move handler records accepted moves in order. The [replay page](frontend/src/components/ReplayPage.jsx) uses those moves to reconstruct earlier board states and offer playback controls. Finish the match, then open `/replay/<room-code>` in your local browser. Scrub several steps forward and back and compare the final score with the live match.

Use the post-game share action to send the outcome, box scores, and a link to play. The [share formatter](frontend/src/utils/shareResult.js) only needs the outcome and scores, so shared results omit player names and room identifiers. Supported browsers open their share sheet. Desktop browsers can copy the same result to the clipboard.

## 5. Verify a change with tests and a production build

Run the checks from the project root after installing the dependencies for each package. Start MongoDB before running the browser suite.

```bash
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm run test:e2e:local -- e2e/11-share-result.spec.js
npm --prefix frontend run build:seo
```

The [share and replay browser test](e2e/11-share-result.spec.js) drives two real clients through all 24 moves, confirms they agree on which edges are taken, then tests sharing, playback, and starting a rematch. It exercises mouse input on desktop and touch input on an emulated Android phone. It intercepts the phone’s native share call to check the payload inside the browser.

The SEO build generates HTML for the public routes so search and link preview crawlers can read metadata without running React. Inspect `frontend/dist/index.html` and `frontend/dist/how-to-play/index.html` after the build. Each page should have one canonical URL, one description, and absolute social image URLs. The sitemap lists the public routes. See [infrastructure](INFRASTRUCTURE.md) for the deployment path.

## Continue the exercise

Pick a small behavior from the [open issues](https://github.com/DhananjayThomble/GridLock/issues?q=is%3Aissue+is%3Aopen). Begin by writing down how a player can reproduce it and the outcome they should see. If you use a coding agent, give it a bounded change and the normal verification commands. Review the diff and evidence yourself, then follow the [pull request guide](CONTRIBUTING.md#making-a-change). For a portfolio write-up, keep the initial reproduction, the design decision, and a repeatable test together.
