---
inclusion: manual
---

# GridLock — Socket.IO Event Reference

Use this reference when working on real-time features, socket handlers, or frontend-backend communication.

## Event Flow: Game Lifecycle

```
Client                          Server
  |-- create_game ------------->|  (gameHandler.js)
  |<-- waiting_for_players -----|
  |                             |
  |-- join_game --------------->|  (gameHandler.js)
  |<-- game_started ------------|  (broadcast to all players)
  |                             |
  |-- make_move --------------->|  (moveHandler.js)
  |<-- game_update -------------|  (broadcast)
  |   ... (repeat) ...         |
  |<-- game_over ---------------|  (broadcast, records to DB)
  |                             |
  |-- request_rematch --------->|  (gameHandler.js)
  |<-- rematch_requested -------|
```

## Event Flow: Matchmaking

```
Client                          Server
  |-- quick_play -------------->|  (matchmakingHandler.js)
  |<-- matchmaking_status ------|
  |<-- game_started ------------|  (when match found)
```

## Event Flow: Ranked

```
Client                          Server
  |-- join_ranked_queue ------->|  (rankedHandler.js)
  |<-- ranked_queue_joined -----|
  |<-- ranked_match_found ------|  (when matched)
  |<-- game_started ------------|
  |   ... (game plays) ...     |
  |<-- ranked_result -----------|  (ELO update)
```

## Event Flow: Tournament

```
Client                          Server
  |-- create_tournament ------->|  (tournamentHandler.js)
  |<-- tournament_created ------|
  |-- join_tournament --------->|
  |<-- tournament_update -------|  (bracket updates)
  |<-- tournament_started ------|
  |<-- game_started ------------|  (each round)
```

## Validation

All incoming socket events are validated against Joi schemas in `backend/middleware/socketSchemas.js`. The validation middleware wraps each handler and rejects malformed payloads with an `error` event.

## Key Payload Shapes

### create_game
```js
{ gridSize: 3|4|5, maxPlayers: 2|3|4, isPrivate: boolean, username: string }
```

### join_game
```js
{ gameId: string, username: string, joinMode: 'player'|'spectator' }
```

### make_move
```js
{ gameId: string, row: number, col: number, sessionToken: string }
```

### game_update (server → client)
```js
{ gameId, gameState: { grid, scores, currentPlayer, moveHistory, ... } }
```

### game_over (server → client)
```js
{ gameId, winner, scores, gameState, ranked: { eloChanges } }
```
