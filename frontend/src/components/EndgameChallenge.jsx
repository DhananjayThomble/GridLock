import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useHref, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../config';
import { capture } from '../lib/posthog';
import { safeStorage } from '../utils/safeStorage';
import { shareOrCopy } from '../utils/shareResult';
import './EndgameChallenge.css';

const COMPLETED_KEY = 'gridlock_endgame_completed';
const VERSION = '1';

function readReferral(params) {
  if (!['v', 'from', 'moves', 'gen'].some((key) => params.has(key))) return null;
  const id = params.get('from') ?? '';
  const moves = params.get('moves') ?? '';
  const generation = Number(params.get('gen'));
  if (params.get('v') !== VERSION || !/^[0-9a-f]{32}$/.test(id) ||
      !/^[0-9a-n]{1,10}$/.test(moves) || !Number.isSafeInteger(generation) || generation < 1) {
    return { invalid: true };
  }
  return { id, moves, generation };
}

function newAttemptId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

async function getBoard(moves, signal, referralMoves) {
  const response = await fetch(`${API_BASE}/api/challenge/v${VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves, referralMoves }),
    signal,
  });
  if (!response.ok) throw new Error('Challenge request failed');
  return response.json();
}

function ChallengeGrid({ state, pending, onMove, boardRef }) {
  const horizontalCount = state.horizontalLines.flat().length;
  const size = state.boxes.length;

  function renderEdges(lines, type, offset) {
    return lines.flatMap((row, r) => row.map((owner, c) => {
      const horizontal = type === 'horizontal';
      const position = { gridRow: r * 2 + (horizontal ? 1 : 2), gridColumn: c * 2 + (horizontal ? 2 : 1) };
      const key = `${type}-${r}-${c}`;
      const className = `endgame-edge ${type}`;
      if (owner || state.winner) {
        return <span key={key} className={className} style={position} data-owner={owner} aria-hidden="true" />;
      }

      const move = (offset + r * row.length + c).toString(24);
      return (
        <button key={key} type="button" className={className} style={position}
          aria-label={`${horizontal ? 'Horizontal' : 'Vertical'} line, row ${r + 1}, column ${c + 1}`}
          aria-disabled={pending} onClick={(event) => onMove(move, event.detail === 0)}
        />
      );
    }));
  }

  return (
    <div className="endgame-grid" role="group" aria-label="Dots and Boxes board" ref={boardRef}>
      {state.boxes.flatMap((row, r) => row.map((owner, c) => (
        <span key={`box-${r}-${c}`} className="endgame-box" data-owner={owner}
          style={{ gridRow: r * 2 + 2, gridColumn: c * 2 + 2 }} aria-hidden="true">
          {owner === 'player1' && '✓'}
          {owner === 'player2' && '×'}
        </span>
      )))}
      {renderEdges(state.horizontalLines, 'horizontal', 0)}
      {renderEdges(state.verticalLines, 'vertical', horizontalCount)}
      {Array.from({ length: (size + 1) ** 2 }, (_, index) => (
        <span key={`dot-${index}`} className="endgame-dot" aria-hidden="true"
          style={{ gridRow: Math.floor(index / (size + 1)) * 2 + 1, gridColumn: index % (size + 1) * 2 + 1 }} />
      ))}
    </div>
  );
}

export default function EndgameChallenge() {
  const [params] = useSearchParams();
  const path = useHref('/challenge/');
  const [referral] = useState(() => readReferral(params));
  const [attemptId, setAttemptId] = useState(newAttemptId);
  const [initialBoard, setInitialBoard] = useState(null);
  const [state, setState] = useState(null);
  const [moves, setMoves] = useState('');
  const [target, setTarget] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [moveError, setMoveError] = useState(false);
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const request = useRef(null);
  const boardRef = useRef(null);
  const resultRef = useRef(null);
  const restoreFocus = useRef(false);
  const movePending = useRef(false);
  const sharing = useRef(false);
  const referred = target !== null;
  const analytics = {
    board_version: VERSION,
    attempt_id: attemptId,
    parent_attempt_id: referred ? referral.id : null,
    generation: referred ? referral.generation : 0,
  };

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    getBoard('', controller.signal, referral?.moves).then(({ state, targetScore }) => {
      if (controller.signal.aborted) return;
      setInitialBoard(state);
      setState(state);
      setTarget(targetScore);
      capture('endgame_opened', {
        board_version: VERSION,
        parent_attempt_id: targetScore !== null ? referral.id : null,
        generation: targetScore !== null ? referral.generation : 0,
      });
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [referral, loadingAttempt]);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    (resultRef.current ?? boardRef.current?.querySelector('button'))?.focus();
  }, [state]);

  async function playMove(move, fromKeyboard) {
    if (movePending.current || state.winner) return;
    const signal = request.current.signal;
    movePending.current = true;
    setPending(true);
    setMoveError(false);
    const nextMoves = moves + move;
    try {
      const { state: next } = await getBoard(nextMoves, signal);
      if (signal.aborted) return;
      restoreFocus.current = fromKeyboard;
      setMoves(nextMoves);
      setState(next);
      if (!moves) capture('endgame_first_move', analytics);
      if (next.winner) {
        const firstFinish = !safeStorage.getItem(COMPLETED_KEY);
        safeStorage.setItem(COMPLETED_KEY, 'true');
        capture('endgame_completed', { ...analytics, score: next.scores.player1, first_finish: firstFinish });
      }
    } catch {
      if (!signal.aborted) setMoveError(true);
    } finally {
      movePending.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  function playAgain(event) {
    restoreFocus.current = event.detail === 0;
    setState(initialBoard);
    setMoves('');
    setAttemptId(newAttemptId());
    setShareStatus('');
  }

  const score = state?.scores.player1 ?? 0;
  const total = state ? state.boxes.length ** 2 : 0;
  const shareParams = new URLSearchParams({
    v: VERSION,
    from: attemptId,
    moves,
    gen: analytics.generation + 1,
  });
  const shareUrl = new URL(`${path}?${shareParams}`, window.location.origin).href;
  const result = referred && state?.winner
    ? score > target ? 'You beat your friend!' : score === target ? 'You tied your friend!' : 'Your friend holds the lead.'
    : 'Challenge complete';

  async function shareChallenge() {
    if (sharing.current) return;
    sharing.current = true;
    try {
      const outcome = await shareOrCopy(`I took ${score} of ${total} boxes in GridLock. Can you beat my score? ${shareUrl}`);
      if (!outcome) return;
      setShareStatus(outcome);
      capture('endgame_shared', { ...analytics, method: outcome });
    } catch {
      setShareStatus('manual');
    } finally {
      sharing.current = false;
    }
  }

  return (
    <div className="endgame">
      <header className="endgame-header">
        <Link to="/">← GridLock lobby</Link>
        <h1>Can you beat my score?</h1>
        <p>Finish a Dots &amp; Boxes board against the bot in about a minute.</p>
      </header>

      {loadError ? (
        <div className="endgame-panel">
          <p role="alert">Couldn’t load the board.</p>
          <button type="button" className="endgame-primary" onClick={() => {
            setLoadError(false);
            setLoadingAttempt(loadingAttempt + 1);
          }}>Try again</button>
        </div>
      ) : !state ? (
        <p role="status">Loading the board…</p>
      ) : (
        <div className="endgame-panel">
          {referral && !referred && <p className="endgame-note">This link’s score is unavailable. You can still play the board.</p>}
          <dl className="endgame-scores">
            <div><dt><span className="endgame-marker player" aria-hidden="true" />You</dt><dd>{score}</dd></div>
            <div><dt><span className="endgame-marker bot" aria-hidden="true" />Bot</dt><dd>{state.scores.player2}</dd></div>
            {referred && <div><dt>Friend</dt><dd>{target}</dd></div>}
          </dl>
          <ChallengeGrid state={state} pending={pending} onMove={playMove} boardRef={boardRef} />
          {state.winner ? (
            <div className="endgame-result">
              <h2 tabIndex={-1} ref={resultRef}>{result}</h2>
              <p role="status">You took {score} of {total} boxes.</p>
              <button type="button" className="endgame-primary" onClick={shareChallenge}>Challenge a friend</button>
              <button type="button" className="endgame-secondary" onClick={playAgain}>Play again</button>
              {shareStatus === 'copied' && <p role="status">Challenge copied. Send it to a friend.</p>}
              {shareStatus === 'manual' && (
                <label className="endgame-manual">
                  Copy this challenge link
                  <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
                </label>
              )}
            </div>
          ) : (
            <>
              <p role="status" className="endgame-note">
                {pending ? 'Playing move…' : moves ? 'Your turn. Choose a dashed line.' : 'Tap a dashed line. Close a box to score and play again.'}
              </p>
              {moveError && <p role="alert">Couldn’t play that move. Try selecting the line again.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
