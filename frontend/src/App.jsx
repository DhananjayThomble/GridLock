// src/App.jsx
import React from 'react';
import {
  BrowserRouter as Router,
  NavLink,
  Route,
  Routes,
  useLocation,
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
  const hideNav = location.pathname === '/game';

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
