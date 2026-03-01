// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Lobby from './components/Lobby';
import Board from './components/Board';
import ErrorBoundary from './components/ErrorBoundary';

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

function App() {
  return (
    <Router basename={basePath}>
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
      </Routes>
    </Router>
  );
}

export default App;
