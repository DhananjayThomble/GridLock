// src/App.jsx
import React from 'react';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import Lobby from './components/Lobby';
import Board from './components/Board';
import Leaderboard from './components/Leaderboard';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

const AppLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const hideNav = location.pathname === '/game';

  const navItems = [
    { to: '/', label: 'Lobby' },
    { to: '/leaderboard', label: 'Leaderboard' },
  ];

  return (
    <>
      {!hideNav && (
        <nav className="app-nav" aria-label="Main navigation">
          {navItems.map(({ to, label }) => {
            const isActive = location.pathname === to;
            return (
              <a
                key={to}
                href={to}
                className={`app-nav-link ${isActive ? 'active' : ''}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(to);
                }}
              >
                {label}
              </a>
            );
          })}
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
        </Routes>
      </div>
    </>
  );
};

function App() {
  return (
    <Router basename={basePath}>
      <AppLayout />
    </Router>
  );
}

export default App;
