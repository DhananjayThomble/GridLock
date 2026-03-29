// src/components/HowToPlay.jsx
// SEO-rich "How to Play" page — targets 'how to play dots and boxes' queries

import React from 'react';
import { Link } from 'react-router-dom';
import './HowToPlay.css';

const Section = ({ emoji, title, children }) => (
  <section className="htp-section">
    <h2 className="htp-section-title">
      {emoji && <span className="htp-emoji">{emoji}</span>}
      {title}
    </h2>
    {children}
  </section>
);

const Card = ({ emoji, title, desc }) => (
  <div className="htp-card">
    <span className="htp-card-emoji">{emoji}</span>
    <h3 className="htp-card-title">{title}</h3>
    <p className="htp-card-desc">{desc}</p>
  </div>
);

const HowToPlay = () => {
  return (
  <div className="htp-container">
    {/* Hero */}
    <header className="htp-hero">
      <h1 className="htp-hero-title">
        How to Play <span className="htp-brand">GridLock</span> — Dots &amp; Boxes Online
      </h1>
      <p className="htp-hero-subtitle">
        The classic Dots &amp; Boxes game — reimagined for online multiplayer.
        Learn the rules, master the strategy, and play Dots and Boxes against
        players worldwide.
      </p>
    </header>

    {/* Basic Rules */}
    <Section emoji="📏" title="GridLock Rules — How Dots & Boxes Works">
      <ol className="htp-rules-list" role="list">
        <li>
          <strong>Draw a line.</strong> Players take turns drawing a single line
          between two adjacent dots on the grid. In dots and boxes online, each
          move is synced in real-time.
        </li>
        <li>
          <strong>Claim boxes.</strong> Complete the fourth side of a square to
          claim it — you earn a point and get an <em>extra turn</em>.
        </li>
        <li>
          <strong>Chain reactions.</strong> Claiming one box can set up the next.
          Skilled players chain multiple captures in a single turn.
        </li>
        <li>
          <strong>Most boxes wins.</strong> The game ends when every line is
          drawn. The player with the most boxes wins!
        </li>
      </ol>
    </Section>

    {/* Game Modes */}
    <Section emoji="🎮" title="Game Modes">
      <div className="htp-card-grid">
        <Card
          emoji="🌐"
          title="Online Multiplayer"
          desc="Play Dots and Boxes multiplayer with 2–4 players in real-time via WebSocket. Create a room or join one instantly."
        />
        <Card
          emoji="🤖"
          title="CPU Opponents"
          desc="Practice against AI with Easy, Medium, or Hard difficulty. Perfect for sharpening your skills."
        />
        <Card
          emoji="🏆"
          title="Tournaments"
          desc="Compete in 4 or 8 player single-elimination brackets. Last player standing wins."
        />
        <Card
          emoji="⚡"
          title="Quick Play"
          desc="Jump into a game instantly with automatic matchmaking. No setup, no waiting."
        />
        <Card
          emoji="📊"
          title="Ranked Mode"
          desc="Climb the ladder with ELO-based matchmaking. Face opponents at your skill level."
        />
        <Card
          emoji="📅"
          title="Daily Challenge"
          desc="A new puzzle every day. Compete for the best score on the same board as everyone else."
        />
      </div>
    </Section>

    {/* Strategy Tips */}
    <Section emoji="🧠" title="GridLock Strategy Tips">
      <div className="htp-tips">
        <div className="htp-tip">
          <span className="htp-tip-number">1</span>
          <div>
            <h3>Control the Center</h3>
            <p>
              Central lines influence more boxes than edges. Prioritize the
              middle of the board to maximize your options.
            </p>
          </div>
        </div>
        <div className="htp-tip">
          <span className="htp-tip-number">2</span>
          <div>
            <h3>The Double-Cross Technique</h3>
            <p>
              Sacrifice a small chain of 2 boxes to force your opponent to open a
              larger chain for you. This is <em>the</em> key to advanced play.
            </p>
          </div>
        </div>
        <div className="htp-tip">
          <span className="htp-tip-number">3</span>
          <div>
            <h3>Think Ahead</h3>
            <p>
              Every line you draw changes the board. Avoid completing the third
              side of a box — you're handing your opponent a free capture.
            </p>
          </div>
        </div>
        <div className="htp-tip">
          <span className="htp-tip-number">4</span>
          <div>
            <h3>Count the Lines</h3>
            <p>
              In the endgame, count remaining lines to predict who gets the last
              move. Parity decides close games.
            </p>
          </div>
        </div>
      </div>
    </Section>

    {/* Grid Sizes */}
    <Section emoji="📐" title="Grid Sizes">
      <div className="htp-grid-sizes">
        {[
          { size: '3×3', label: 'Quick', desc: '9 boxes — fast games, great for learning dots and boxes' },
          { size: '4×4', label: 'Standard', desc: '16 boxes — the balanced classic' },
          { size: '5×5', label: 'Pro', desc: '25 boxes — deeper strategy, longer games' },
          { size: '6×6', label: 'Epic', desc: '36 boxes — the ultimate test of skill' },
        ].map(({ size, label, desc }) => (
          <div key={size} className="htp-grid-size-item">
            <span className="htp-grid-size-label">{size}</span>
            <strong>{label}</strong>
            <p>{desc}</p>
          </div>
        ))}
      </div>
    </Section>

    {/* Features */}
    <Section emoji="✨" title="Features">
      <ul className="htp-features-list">
        <li>👀 <strong>Spectator Mode</strong> — Watch live games without interfering</li>
        <li>🔁 <strong>Game Replay</strong> — Review any completed game move-by-move</li>
        <li>🌗 <strong>Dark &amp; Light Theme</strong> — Play in the mode that suits you</li>
        <li>📱 <strong>PWA Support</strong> — Install on your phone, play offline-ready</li>
        <li>🔊 <strong>Sounds &amp; Haptics</strong> — Satisfying feedback on every move</li>
        <li>📈 <strong>Leaderboard</strong> — Track your ranking against all players</li>
        <li>🔗 <strong>Share Links</strong> — Invite friends with a single link</li>
      </ul>
    </Section>

    {/* CTA */}
    <section className="htp-cta">
      <h2 className="htp-cta-title">Ready to Play GridLock?</h2>
      <p className="htp-cta-desc">
        Jump into a game and put your GridLock strategy to the test.
      </p>
      <Link to="/" className="htp-cta-button">
        Start a Game Now 🎯
      </Link>
    </section>
  </div>
  );
};

export default HowToPlay;
