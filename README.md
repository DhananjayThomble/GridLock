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
```
Create a `.env` file in the `backend` directory:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/gridlock
```
Start the server:
```bash
npm start
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
```
Update the Socket connection URL in `src/components/Board.jsx` and `src/components/Lobby.jsx` if necessary (defaults to relative `/socket.io/` for Nginx proxy, but for local dev you may need `http://localhost:5000`).

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

## 📝 License

This project is private and maintained by Dhananjay Thomble.
