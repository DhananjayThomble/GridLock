// src/App.jsx
import React, { Suspense, lazy } from 'react';
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
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionOverlay from './components/ConnectionOverlay';
import BottomNav from './components/BottomNav';
import PageSeo from './components/PageSeo';
import ScrollToTop from './components/ScrollToTop';
import './App.css';

// Lazy-loaded route components — split into separate chunks to reduce initial bundle
const Leaderboard = lazy(() => import('./components/Leaderboard'));
const Profile = lazy(() => import('./components/Profile'));
const TournamentLobby = lazy(() => import('./components/TournamentLobby'));
const JoinGame = lazy(() => import('./components/JoinGame'));
const ReplayPage = lazy(() => import('./components/ReplayPage'));
const GameHistory = lazy(() => import('./components/GameHistory'));
const DailyChallenge = lazy(() => import('./components/DailyChallenge'));
const HowToPlay = lazy(() => import('./components/HowToPlay'));
const Settings = lazy(() => import('./components/Settings'));
const WaitingRoom = lazy(() => import('./components/WaitingRoom'));

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

const withPageSeo = (element, seo) => (
  <>
    <PageSeo {...seo} />
    {element}
  </>
);

/** Simple loading spinner shown while lazy chunks load */
const RouteLoader = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '40vh',
    }}
    role="status"
    aria-label="Loading page"
  >
    <div
      style={{
        width: 36,
        height: 36,
        border: '3px solid rgba(128,128,128,0.2)',
        borderTopColor: '#646cff',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const AppLayout = () => {
  const location = useLocation();
  const hideNav = location.pathname === '/game' || location.pathname === '/tournament' || location.pathname === '/daily' || location.pathname.startsWith('/join/') || location.pathname.startsWith('/replay/') || location.pathname.startsWith('/waiting/');

  return (
    <>
      {!hideNav && (
        <nav className="app-nav" aria-label="Main navigation">
          <NavLink to="/" end className={({ isActive }) => `app-nav-link top-nav-hide-mobile ${isActive ? 'active' : ''}`}>
            Lobby
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => `app-nav-link top-nav-hide-mobile ${isActive ? 'active' : ''}`}>
            <span className="nav-label-full">Leaderboard</span>
            <span className="nav-label-short">Board</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `app-nav-link top-nav-hide-mobile ${isActive ? 'active' : ''}`}>
            History
          </NavLink>
          <NavLink to="/how-to-play" className={({ isActive }) => `app-nav-link top-nav-hide-mobile ${isActive ? 'active' : ''}`}>
            Rules
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `app-nav-link top-nav-hide-mobile ${isActive ? 'active' : ''}`} aria-label="Settings">
            ⚙️
          </NavLink>
        </nav>
      )}

      {!hideNav && <BottomNav />}

      <main className={hideNav ? '' : 'app-content-with-nav'}>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route
              path="/"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <Lobby />,
                    {
                      title: 'Play Dots & Boxes Multiplayer',
                      description: 'Play GridLock, a real-time multiplayer Dots & Boxes game built for competitive online matches.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/game"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <Board />,
                    {
                      title: 'Live Match',
                      description: 'Play a live GridLock match with real-time multiplayer Dots & Boxes gameplay.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/leaderboard"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <Leaderboard />,
                    {
                      title: 'Leaderboard',
                      description: 'See the top GridLock players and track the latest multiplayer Dots & Boxes rankings.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/history"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <GameHistory />,
                    {
                      title: 'Match History',
                      description: 'Review recent GridLock matches, outcomes, and performance history.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/daily"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <DailyChallenge />,
                    {
                      title: 'Daily Challenge',
                      description: "Take on today's GridLock daily challenge and compare your score on the leaderboard.",
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/tournament"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <TournamentLobby />,
                    {
                      title: 'Tournament',
                      description: 'Enter the GridLock tournament lobby for competitive multiplayer brackets.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/join/:gameId"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <JoinGame />,
                    {
                      title: 'Join Game',
                      description: 'Join a shared GridLock match and jump straight into a multiplayer game.',
                    },
                  )}
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
                  {withPageSeo(
                    <Profile />,
                    {
                      title: 'Player Profile',
                      description: 'View GridLock player stats, rank, and recent performance.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/replay/:gameId"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <ReplayPage />,
                    {
                      title: 'Match Replay',
                      description: 'Watch a completed GridLock match replay and study every move.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/how-to-play"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <HowToPlay />,
                    {
                      title: 'How to Play — Rules, Strategy & Tips',
                      description: 'Learn how to play GridLock, the online Dots & Boxes game. Master the rules, strategy tips, double-cross technique, and game modes.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/settings"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <Settings />,
                    {
                      title: 'Settings',
                      description: 'Customize your GridLock experience — theme, sound, notifications, and display preferences.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route path="/replays" element={<Navigate to="/history" replace />} />
            {/* Catch-all: redirect unknown routes to home instead of 404 — acceptable UX for a game app */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
};

function App() {
  return (
    <ThemeProvider>
      <Router basename={basePath}>
        <ScrollToTop />
        <ConnectionOverlay />
        <AppLayout />
      </Router>
    </ThemeProvider>
  );
}

export default App;
