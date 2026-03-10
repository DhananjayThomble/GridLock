# GridLock

GridLock is a real-time, web-based multiplayer implementation of the classic "Dots and Boxes" game. Built using the MERN stack (MongoDB, Express, React, Node.js) and Socket.io, it allows players to create rooms and play against each other instantly.

## 🚀 Features

- **Real-Time Multiplayer:** Play against friends over the internet with zero lag using Socket.io.
- **Customizable Grids:** Choose from different grid sizes (3x3, 4x4, 5x5) when creating a game room.
- **Strict Turn-Based Logic:** Backend-authoritative game state prevents cheating and ensures perfect synchronization.
- **Responsive UI:** Clean, modern interface built with React and Tailwind CSS.
- **Room Management:** Easy-to-use lobby system for creating and joining private game sessions.

## 🛠️ Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, Socket.io-client, React Router
- **Backend:** Node.js, Express, Socket.io
- **Database:** MongoDB, Mongoose
- **Deployment/Server:** PM2 (Process Management), Nginx (Reverse Proxy)

## 📦 Local Setup

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB running locally or a MongoDB Atlas connection string.

### 1. Clone the repository
```bash
git clone https://github.com/DhananjayThomble/GridLock.git
cd GridLock
```

### 2. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
```
Edit `.env` as needed (Mongo is required for persistence; Redis is optional but recommended for scaling).

Start the server:
```bash
npm start
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
cp .env.example .env
```
After copying `.env.example` to `.env`, open `.env` and review:
- `VITE_SOCKET_URL` — Backend WebSocket/API URL
  - Local dev: leave empty (proxied by Vite)
  - Hosted frontend (e.g. GitHub Pages): set to your backend URL
- `VITE_API_BASE_URL` — REST API base URL (for Leaderboard, etc.)
  - Falls back to `VITE_SOCKET_URL` if unset
- `VITE_SITE_URL` — Public site URL (for OG/meta tags in production)

Start the development server:
```bash
npm run dev
```

## 🎮 How to Play

1. Open the application in your browser.
2. **Player 1** enters their name, selects a grid size, and clicks "Create Game".
3. **Player 1** shares the generated Game ID with Player 2.
4. **Player 2** enters their name, pastes the Game ID, and clicks "Join Game".
5. The game begins! Click on the faint grey lines to draw a solid line.
6. When you draw the 4th line of a 1x1 square, you capture the box, earn a point, and get a bonus turn.
7. The game ends when all boxes are claimed. The player with the highest score wins!

## 🔐 Production Deployment Notes (HTTPS / WSS)

- Terminate TLS at reverse proxy (Nginx/Caddy) and expose only `443` publicly.
- Proxy Socket.IO traffic over **WSS** to backend (`/socket.io/`).
- Set `VITE_SOCKET_URL=https://<your-api-domain>` for cross-origin deployments.
- Set `CORS_ORIGIN` in backend `.env` to allowed origins only (comma-separated).
- Backend emits security headers via `helmet`, plus a restrictive API CSP header.

Minimal Nginx sketch:
```nginx
location /socket.io/ {
  proxy_pass http://127.0.0.1:5000/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}

location /api/ {
  proxy_pass http://127.0.0.1:5000/api/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 📝 License

This project is private and maintained by Dhananjay Thomble.
# test
