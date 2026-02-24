# 4-Player Beta Implementation - Next Steps

## ✅ Completed So Far

### Backend (100% Complete)
- ✅ Enhanced game logic for 2-4 players
- ✅ Production-grade server.js with multiplayer support
- ✅ Comprehensive unit tests (96.8% passing)
- ✅ Error handling & validation
- ✅ Structured logging
- ✅ Player color system implemented
- ✅ Code committed to feature/4-player-beta branch

### Frontend (30% Complete)
- ✅ Lobby.jsx updated with player count selector
- ⏳ Board.jsx needs updates for 4-player display
- ⏳ Color-coded game pieces needed
- ⏳ 4-player scoreboard needed
- ⏳ Winner modal needs 4-player support

## 🚧 Remaining Tasks

### 1. Update Board.jsx for 4 Players

**File**: `~/GridLock/frontend/src/components/Board.jsx`

**Changes Needed**:
```javascript
// Add color mapping
const PLAYER_COLORS = {
    player1: '#3B82F6', // Blue
    player2: '#EF4444', // Red
    player3: '#10B981', // Green
    player4: '#A855F7'  // Purple
};

// Update renderLine function to use dynamic colors
const getPlayerColor = (playerId) => {
    return gameState[`${playerId}Color`] || PLAYER_COLORS[playerId];
};

// Update scoreboard to show all players dynamically
const renderScoreboard = () => {
    const playerCount = gameState.playerCount || 2;
    return (
        <div className="grid grid-cols-2 gap-2 mb-4">
            {Array.from({ length: playerCount }, (_, i) => {
                const playerId = `player${i + 1}`;
                return renderPlayerScore(playerId);
            })}
        </div>
    );
};

// Update winner modal for multiple players
// Show all player scores, highlight winner
```

**Detailed Steps**:
1. Add `PLAYER_COLORS` constant at top of file
2. Create `getPlayerColor(playerId)` helper function
3. Update `renderLine` to use `getPlayerColor` instead of hardcoded colors
4. Update scoreboard section to loop through `playerCount`
5. Update winner modal to show all players and scores
6. Test with 2, 3, and 4 players

### 2. Build Frontend
```bash
cd ~/GridLock/frontend
npm run build
```

### 3. Configure Nginx for /beta Route

**File**: `/etc/nginx/sites-available/gridlock` (or your config file)

**Add beta location block**:
```nginx
# Beta version (4-player support)
location /beta {
    alias /home/ubuntu/GridLock/frontend/dist-beta;
    try_files $uri $uri/ /index.html;
}

# WebSocket proxy for beta (if needed separately)
location /beta/socket.io/ {
    proxy_pass http://localhost:5000/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

**Steps**:
1. Create separate build for beta: `npm run build -- --outDir dist-beta`
2. Update nginx configuration
3. Test nginx config: `sudo nginx -t`
4. Reload nginx: `sudo systemctl reload nginx`

### 4. Restart Backend
```bash
pm2 restart gridlock-backend
pm2 logs gridlock-backend --lines 50
```

### 5. Testing Checklist

**2-Player Game**:
- [ ] Create game with 2 players
- [ ] Join game
- [ ] Play complete game
- [ ] Winner modal appears correctly
- [ ] Rematch works

**3-Player Game**:
- [ ] Create game with 3 players
- [ ] All 3 players join
- [ ] Turn rotation works (P1→P2→P3→P1)
- [ ] Scoring works
- [ ] Winner determination correct

**4-Player Game**:
- [ ] Create game with 4 players
- [ ] All 4 players join
- [ ] Turn rotation works (P1→P2→P3→P4→P1)
- [ ] Colors display correctly
- [ ] Scoring works
- [ ] Winner determination correct

**Mobile Testing**:
- [ ] Test on actual mobile devices
- [ ] Scoreboard fits on screen
- [ ] All 4 player names visible
- [ ] Touch targets work

### 6. Documentation Updates

Update these files:
- [ ] `README.md` - Add 4-player feature
- [ ] `BETA_PROGRESS.md` - Mark frontend complete
- [ ] `DEVELOPMENT.md` - Add beta deployment notes

## 🎯 Quick Command Reference

```bash
# Frontend development
cd ~/GridLock/frontend
npm run build

# Backend restart
pm2 restart gridlock-backend
pm2 logs gridlock-backend

# Git workflow
git status
git add -A
git commit -m "message"
git push origin feature/4-player-beta

# Test URLs
# Production (2-player): http://13.205.40.30
# Beta (4-player): http://13.205.40.30/beta
```

## 📋 Board.jsx Update Template

Here's a starter template for the Board.jsx changes:

```javascript
// At top of Board.jsx
const PLAYER_COLORS = {
    player1: '#3B82F6',
    player2: '#EF4444',
    player3: '#10B981',
    player4: '#A855F7'
};

// Helper function
const getPlayerColor = (playerId, gameState) => {
    return gameState?.[`${playerId}Color`] || PLAYER_COLORS[playerId] || '#666';
};

// In renderLine function
const lineColor = line === null ? '#E5E7EB' : getPlayerColor(line, gameState);

// Dynamic scoreboard
const renderAllPlayers = () => {
    const playerCount = gameState?.playerCount || 2;
    const players = [];
    
    for (let i = 1; i <= playerCount; i++) {
        const playerId = `player${i}`;
        const name = gameState?.[`${playerId}Name`] || `Player ${i}`;
        const avatar = gameState?.[`${playerId}Avatar`] || '👦';
        const score = gameState?.scores?.[playerId] || 0;
        const color = getPlayerColor(playerId, gameState);
        const isCurrent = gameState?.currentPlayer === playerId;
        
        players.push(
            <div 
                key={playerId}
                className={`p-2 rounded ${isCurrent ? 'ring-2' : ''}`}
                style={{ borderColor: color }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-2xl">{avatar}</span>
                    <div>
                        <div className="font-bold text-sm" style={{ color }}>{name}</div>
                        <div className="text-xs text-gray-600">Score: {score}</div>
                    </div>
                </div>
            </div>
        );
    }
    
    return (
        <div className={`grid gap-2 mb-4 ${playerCount === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
            {players}
        </div>
    );
};
```

## 🔜 After Beta is Ready

1. Test thoroughly with multiple users
2. Gather feedback
3. Fix any bugs
4. Merge to main branch
5. Update production deployment
6. Update documentation
7. Celebrate! 🎉

---

**Current Status**: Backend complete, Frontend 30% complete
**Next Action**: Update Board.jsx using template above
**Estimated Time**: 2-3 hours for frontend + testing
