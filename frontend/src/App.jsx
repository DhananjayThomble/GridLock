// src/App.jsx
import React from 'react';
import {
  BrowserRouter as Router,
  NavLink,
  Route,
  Routes,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Lobby from './components/Lobby';
import Board from './components/Board';
import Leaderboard from './components/Leaderboard';
import Profile from './components/Profile';
import TournamentLobby from './components/TournamentLobby';
import JoinGame from './components/JoinGame';
import ReplayPage from './components/ReplayPage';
import GameHistory from './components/GameHistory';
import DailyChallenge from './components/DailyChallenge';
import HowToPlay from './components/HowToPlay';
import Settings from './components/Settings';
import WaitingRoom from './components/WaitingRoom';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionOverlay from './components/ConnectionOverlay';
import './App.css';

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

const AppLayout = () => {
  const location = useLocation();
  const hideNav = location.pathname === '/game' || location.pathname === '/tournament' || location.pathname === '/daily' || location.pathname.startsWith('/join/') || location.pathname.startsWith('/profile/') || location.pathname.startsWith('/replay/') || location.pathname.startsWith('/waiting/');

  return (
    <>
      {!hideNav && (
        <nav className="app-nav" aria-label="Main navigation">
          <NavLink to="/" end className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
            Lobby
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
            Leaderboard
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
            History
          </NavLink>
          <NavLink to="/how-to-play" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
            Rules
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`} aria-label="Settings">
            ⚙️
          </NavLink>
        </nav>
      )}

      <div className={hideNav ? '' : 'app-content-with-nav'}>
        <Routes>
          <Route
            path="/"
            element={(
              <ErrorBoundary>
                <Lobby />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/game"
            element={(
              <ErrorBoundary>
                <Board />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/leaderboard"
            element={(
              <ErrorBoundary>
                <Leaderboard />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/history"
            element={(
              <ErrorBoundary>
                <GameHistory />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/daily"
            element={(
              <ErrorBoundary>
                <DailyChallenge />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/tournament"
            element={(
              <ErrorBoundary>
                <TournamentLobby />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/join/:gameId"
            element={(
              <ErrorBoundary>
                <JoinGame />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/waiting/:gameId"
            element={(
              <ErrorBoundary>
                <WaitingRoom />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/profile/:username"
            element={(
              <ErrorBoundary>
                <Profile />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/replay/:gameId"
            element={(
              <ErrorBoundary>
                <ReplayPage />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/how-to-play"
            element={(
              <ErrorBoundary>
                <HowToPlay />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/settings"
            element={(
              <ErrorBoundary>
                <Settings />
              </ErrorBoundary>
            )}
          />
          <Route path="/replays" element={<Navigate to="/history" replace />} />
          {/* Catch-all: redirect unknown routes to home instead of 404 — acceptable UX for a game app */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
};

function App() {
  return (
    <ThemeProvider>
      <Router basename={basePath}>
        <ConnectionOverlay />
        <AppLayout />
      </Router>
    </ThemeProvider>
  );
}

export default App;
