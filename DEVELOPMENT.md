# GridLock Development Guide

## 🏗️ Architecture

### Stack
- **Frontend**: React (Vite) + Tailwind CSS + Socket.IO Client
- **Backend**: Node.js + Express + Socket.IO Server
- **Database**: MongoDB (configured, currently using in-memory for MVP)
- **Deployment**: 
  - Frontend: Nginx (port 80)
  - Backend: PM2 cluster mode (port 5000, 1 instance for in-memory state)

### Key Design Decisions
- **In-memory game state**: Using Map object for fast MVP iteration
- **Backend authoritative**: All game logic runs on server
- **Real-time sync**: Socket.IO for instant updates
- **Shared socket instance**: Prevents duplicate connections

---

## 📋 Code Standards

### JavaScript/React
- Use functional components with hooks
- PropTypes or TypeScript for type safety (TODO)
- Consistent naming: camelCase for variables, PascalCase for components
- Keep components under 300 lines

### CSS/Tailwind
- Mobile-first responsive design
- Reusable utility classes
- Avoid inline styles unless dynamic

### Backend
- Structured logging with levels (DEBUG, INFO, WARN, ERROR)
- Input validation on all endpoints
- Error handling with try-catch
- Never trust client input

---

## 🔄 Development Workflow

### 1. Feature Development
```bash
# Always start with a feature branch
git checkout -b feature/feature-name

# Make changes, test locally
cd frontend && npm run build
pm2 restart gridlock-backend

# Commit with descriptive messages
git add -A
git commit -m "Feature: Description of change

- Bullet point 1
- Bullet point 2"

git push origin feature/feature-name
```

### 2. Testing Before Deploy
- Run automated tests: `node backend/test-game-flow.js`
- Manual testing on actual devices
- Check PM2 logs: `pm2 logs gridlock-backend --lines 50`

### 3. Pull Request & Review
- Create PR with clear description
- Review changes on GitHub
- Merge to main only after testing

---

## 🧪 Quality Checklist

Before marking any feature as "done":

- [ ] Code follows standards above
- [ ] Works on mobile (test on actual device)
- [ ] No console errors in browser/server
- [ ] Automated tests pass
- [ ] UI is responsive (all screen sizes)
- [ ] Error states handled gracefully
- [ ] Loading states implemented
- [ ] Backend logs properly
- [ ] Git commit messages are clear
- [ ] Branch pushed to GitHub

---

## 🚀 Deployment Process

### Frontend
```bash
cd ~/GridLock/frontend
npm run build
# Nginx serves from dist/
```

### Backend
```bash
pm2 restart gridlock-backend
pm2 logs gridlock-backend --lines 50
```

### Quick Health Check
```bash
# Backend running?
pm2 status

# Frontend served?
curl http://13.205.40.30

# Check logs
pm2 logs gridlock-backend --lines 20
```

---

## 🎨 UI/UX Guidelines

- **Mobile-first**: Design for phones, scale up
- **Animations**: Subtle, not distracting
- **Feedback**: Every action needs visual response
- **Colors**: Consistent with game theme
- **Accessibility**: Good contrast, readable fonts

---

## 🐛 Debugging

### Frontend Issues
1. Check browser console (F12)
2. Verify socket connection: look for "Board using shared socket connection"
3. Check network tab for failed requests

### Backend Issues
1. Check PM2 logs: `pm2 logs gridlock-backend --lines 100`
2. Verify game state in logs (DEBUG level)
3. Check MongoDB connection if using DB

### Common Issues
- **Socket disconnects**: Check Nginx WebSocket proxy config
- **State desync**: Ensure PM2 runs 1 instance (not cluster)
- **Build errors**: Clear cache, reinstall dependencies

---

## 📈 Future Improvements

### Phase 1 (MVP) ✅
- [x] Basic 2-player gameplay
- [x] Avatar selection
- [x] Winner celebration
- [x] Mobile-responsive UI

### Phase 2 (Next)
- [ ] User authentication
- [ ] Persistent game history (MongoDB)
- [ ] 4-player support
- [ ] Matchmaking system

### Phase 3 (Advanced)
- [ ] Redis for multi-instance support
- [ ] Leaderboards
- [ ] Tournaments
- [ ] AI opponents

---

## 🤖 Working with OpenClaw

### Best Practices
1. **Be specific**: "Fix the winner popup to show player name" > "Fix the game"
2. **Provide context**: Share screenshots, error logs
3. **Iterate**: Build features incrementally
4. **Test immediately**: Don't stack untested changes
5. **Document decisions**: Update this file with learnings

### Model Selection
- **GPT-4o** (current): Balanced, good for general development
- **Claude Opus 4.6**: Complex architecture decisions
- **Claude Sonnet 4.6**: Fast iterations, bug fixes

---

## 📝 Notes

- Keep this file updated as the project evolves
- Document all major decisions and their rationale
- Track technical debt for future cleanup
