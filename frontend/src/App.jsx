// src/App.jsx
import React, { Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter as Router,
  NavLink,
  Route,
  Routes,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { GridThemeProvider } from './contexts/GridThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Lobby from './components/Lobby';
import Board from './components/Board';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectionOverlay from './components/ConnectionOverlay';
import BottomNav from './components/BottomNav';
import PageSeo from './components/PageSeo';
import ScrollToTop from './components/ScrollToTop';
import AuthAvatar from './components/AuthAvatar';
import ToastProvider, { useToast } from './contexts/ToastContext';
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
const ChallengePage = lazy(() => import('./components/ChallengePage'));
const AuthSetup = lazy(() => import('./components/AuthSetup'));

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

const withPageSeo = (element, seo) => (
  <>
    <PageSeo {...seo} />
    {element}
  </>
);

/** Redirect to lobby with a toast message for unknown routes */
const NotFoundRedirect = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    showToast('Page not found — returned to lobby', { type: 'error', duration: 4000 });
    navigate('/', { replace: true });
  }, [navigate, showToast]);
  return null;
};

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

/** Redirect authenticated users who haven't set up their username */
const AuthSetupRedirect = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const shouldRedirect = !loading && user && !user.usernameSetupComplete && location.pathname !== '/auth/setup';

  useEffect(() => {
    if (shouldRedirect) {
      // Preserve the original path so user can be routed back after setup
      const returnTo = location.pathname + location.search;
      const safeReturnTo = returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      navigate(`/auth/setup${safeReturnTo}`, { replace: true });
    }
  }, [shouldRedirect, navigate, location.pathname, location.search]);

  // Prevent content flash while redirect is pending
  if (shouldRedirect) return <RouteLoader />;
  return null;
};

const AppLayout = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const hideNav = location.pathname === '/game' || location.pathname === '/tournament' || location.pathname.startsWith('/join/') || location.pathname.startsWith('/replay/') || location.pathname.startsWith('/waiting/');

  // Block layout rendering while auth setup redirect is pending (#6 Copilot review)
  const needsSetupRedirect = !loading && user && !user.usernameSetupComplete && location.pathname !== '/auth/setup';
  if (needsSetupRedirect) {
    return <AuthSetupRedirect />;
  }

  return (
    <>
      <AuthSetupRedirect />
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
          <div className="app-nav-avatar top-nav-hide-mobile">
            <AuthAvatar />
          </div>
        </nav>
      )}
      {!hideNav && (
        <div className="mobile-header">
          <span className="mobile-header-title">GridLock</span>
          <div className="mobile-header-actions">
            <AuthAvatar />
          </div>
        </div>
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
                      title: 'Play Dots & Boxes Online Free | Multiplayer',
                      description: 'Challenge friends to the classic dots and boxes strategy game. 2-4 players, real-time multiplayer, tournaments, daily challenges. Free, no download.',
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
                      title: 'Leaderboard — Top Players & Rankings',
                      description: 'See the top GridLock players ranked by wins and ELO rating.',
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
                      title: 'Game History',
                      description: 'Browse your past GridLock games with replays and stats.',
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
                      title: 'Daily GridLock Challenge — Today\'s Puzzle',
                      description: "Play today's GridLock challenge. Same puzzle for everyone. Compare your score on the daily leaderboard.",
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
                      title: 'Game Replay',
                      description: 'Watch a GridLock game replay move by move.',
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
                      title: 'How to Play GridLock — Rules & Strategy Guide',
                      description: 'Learn how to play dots and boxes in 2 minutes. Simple rules, deep strategy. Tap lines, complete boxes, outscore your opponent.',
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
                      description: 'Customize your GridLock experience. Themes, sounds, notifications.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route path="/replays" element={<Navigate to="/history" replace />} />
            <Route
              path="/play/:username"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <ChallengePage />,
                    {
                      title: 'Challenge — Play GridLock',
                      description: 'You\'ve been challenged to a GridLock match! Accept and play now.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            <Route
              path="/auth/setup"
              element={(
                <ErrorBoundary>
                  {withPageSeo(
                    <AuthSetup />,
                    {
                      title: 'Choose Username — GridLock',
                      description: 'Pick your permanent GridLock username.',
                    },
                  )}
                </ErrorBoundary>
              )}
            />
            {/* Catch-all: show toast and redirect unknown routes to lobby (#418) */}
            <Route path="*" element={<NotFoundRedirect />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
};

function App() {
  return (
    <ThemeProvider>
      <GridThemeProvider>
        <ToastProvider>
          <Router basename={basePath}>
            <AuthProvider>
              <ScrollToTop />
              <ConnectionOverlay />
              <AppLayout />
            </AuthProvider>
          </Router>
        </ToastProvider>
      </GridThemeProvider>
    </ThemeProvider>
  );
}

export default App;
