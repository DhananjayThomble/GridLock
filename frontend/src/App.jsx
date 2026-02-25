// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Lobby from './components/Lobby';
import Board from './components/Board';

// Support /beta sub-path deployment via Vite's BASE_URL
const basePath = import.meta.env.BASE_URL || '/';

function App() {
  return (
    <Router basename={basePath}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/game" element={<Board />} />
      </Routes>
    </Router>
  );
}

export default App;
