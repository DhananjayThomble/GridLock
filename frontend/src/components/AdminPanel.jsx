import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';
import './AdminPanel.css';

const sections = ['Overview', 'Accounts', 'Games', 'Audit'];
const gameStatuses = ['waiting', 'playing', 'finished', 'abandoned'];
const dateTime = value => value ? new Date(value).toLocaleString() : '—';
const actionName = (kind, blocked) => kind === 'account'
  ? (blocked ? 'Suspend sign-in' : 'Restore sign-in')
  : (blocked ? 'Mute room chat' : 'Unmute room chat');

async function adminRequest(path, options) {
  const response = await fetch(`${API_BASE}/api/admin/${path}`, { credentials: 'include', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The admin request failed. Try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AdminPanel() {
  const { login } = useAuth();
  const [section, setSection] = useState('Overview');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selection, setSelection] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page, search, status });
    adminRequest(`${section.toLowerCase()}?${params}`, { signal: controller.signal })
      .then(setData)
      .catch(err => { if (!controller.signal.aborted) setError(err); });
    return () => controller.abort();
  }, [section, page, search, status, revision]);

  function reload() {
    setData(null);
    setError(null);
    setRevision(value => value + 1);
  }

  function openAction(kind, target, label, blocked) {
    setSelection({ kind, target, label, blocked });
    setReason('');
    setActionError('');
    setNotice('');
  }

  async function submitAction(event) {
    event.preventDefault();
    setSaving(true);
    setActionError('');
    try {
      const { kind, target, blocked } = selection;
      await adminRequest('moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ kind, target, blocked, reason }),
      });
      setSelection(null);
      setNotice('Moderation action saved.');
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory(account) {
    setHistory({ account });
    try {
      const result = await adminRequest(`accounts/${account._id}/history`);
      setHistory(current => current?.account === account ? { account, ...result } : current);
    } catch (err) {
      setHistory(current => current?.account === account ? { account, error: err.message } : current);
    }
  }

  return (
    <div className="admin-panel">
      <header><h1>GridLock Admin</h1><Link to="/">Back to GridLock</Link></header>
      {error?.status === 401 ? (
        <section><p>Sign in with an authorized Google account.</p><button onClick={login}>Sign in with Google</button></section>
      ) : error?.status === 403 ? (
        <p role="alert">This account does not have admin access.</p>
      ) : (
        <>
          <nav aria-label="Admin sections">
            {sections.map(name => <button key={name} aria-pressed={section === name} disabled={saving}
              onClick={() => {
                setSection(name); setSearch(''); setDraftSearch(''); setPage(1); setStatus('');
                setHistory(null); setSelection(null); setNotice(''); reload();
              }}>{name}</button>)}
            <button disabled={saving} onClick={reload}>Refresh</button>
          </nav>
          {(section === 'Accounts' || section === 'Games') && (
            <form className="admin-controls" onSubmit={event => {
              event.preventDefault(); setSearch(draftSearch.trim()); setPage(1); setHistory(null); reload();
            }}>
              <label>{section === 'Accounts' ? 'Exact username or email' : 'Room code'}
                <input value={draftSearch} maxLength={section === 'Accounts' ? 254 : 8}
                  onChange={event => setDraftSearch(event.target.value)} />
              </label>
              {section === 'Games' && <label>Status
                <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); reload(); }}>
                  <option value="">All</option>
                  {gameStatuses.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>}
              <button>Search</button>
            </form>
          )}
          {notice && <p role="status">{notice}</p>}
          {selection && (
            <form className="admin-controls admin-action" onSubmit={submitAction}>
              <strong>{actionName(selection.kind, selection.blocked)} for {selection.label}</strong>
              <label>Reason<textarea required maxLength={300} value={reason}
                onChange={event => setReason(event.target.value)} /></label>
              <button disabled={saving || !reason.trim()}>Confirm action</button>
              <button type="button" disabled={saving} onClick={() => setSelection(null)}>Cancel</button>
              {actionError && <p role="alert">{actionError}</p>}
            </form>
          )}
          {error ? <p role="alert">{error.message}</p> : !data ? <p role="status">Loading…</p> : (
            <>
              {section === 'Overview' && <dl className="admin-metrics">
                {Object.entries({
                  Operator: data.operator, Accounts: data.accounts, 'Ranked profiles': data.rankedPlayers,
                  'Daily results today (UTC)': data.dailyResults, 'Matches finished today (UTC)': data.finishedToday,
                  'Live store entries': data.activeStoreEntries, 'Connected sockets': data.connectedSockets,
                  'Server uptime (seconds)': data.uptimeSeconds,
                }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
              </dl>}
              {section === 'Accounts' && <AdminTable columns={['Player', 'Email', 'Last sign-in', 'Status', 'Actions']}>
                {data.items.map(account => <tr key={account._id}>
                  <td>{account.username} ({account.displayName})</td><td>{account.email}</td>
                  <td>{dateTime(account.lastLoginAt)}</td><td>{account.operator ? 'Operator' : account.suspended ? 'Suspended' : 'Active'}</td>
                  <td><button onClick={() => loadHistory(account)}>Recent matches</button>{' '}
                    <button disabled={saving || account.operator} onClick={() => openAction('account', account._id, account.username, !account.suspended)}>
                      {actionName('account', !account.suspended)}
                    </button></td>
                </tr>)}
              </AdminTable>}
              {section === 'Games' && <AdminTable columns={['Room', 'Status', 'Players and scores', 'Last activity', 'Chat', 'Actions']}>
                {data.items.map(game => <tr key={game._id}>
                  <td>{game.gameId} ({game.gridSize}×{game.gridSize})</td><td>{game.status}</td>
                  <td>{Object.entries(game.players || {}).map(([seat, player]) => (
                    <div key={seat}>{player.username} ({game.gameState?.scores?.[seat] ?? 0})</div>
                  ))}</td>
                  <td>{dateTime(game.lastActivityAt)}</td><td>{game.chatMuted ? 'Muted' : 'Enabled'}</td>
                  <td>{game.status === 'finished' && <Link to={`/replay/${game.gameId}`}>Replay</Link>}
                    {['waiting', 'playing'].includes(game.status) && <button disabled={saving}
                      onClick={() => openAction('room-chat', game.gameId, game.gameId, !game.chatMuted)}>
                      {actionName('room-chat', !game.chatMuted)}
                    </button>}</td>
                </tr>)}
              </AdminTable>}
              {section === 'Audit' && <AdminTable columns={['Time', 'Operator', 'Action', 'Target', 'Reason']}>
                {data.items.map(entry => <tr key={entry._id}>
                  <td>{dateTime(entry.createdAt)}</td><td>{entry.actor}</td>
                  <td>{actionName(entry.kind, entry.blocked)}</td><td>{entry.label}</td><td>{entry.reason}</td>
                </tr>)}
              </AdminTable>}
              {data.items && <nav className="admin-controls" aria-label="Pagination">
                <button disabled={page === 1 || saving} onClick={() => { setPage(page - 1); reload(); }}>Previous</button>
                <span>Page {page}</span>
                <button disabled={!data.hasMore || saving} onClick={() => { setPage(page + 1); reload(); }}>Next</button>
              </nav>}
              {section === 'Accounts' && history && <section className="admin-action">
                <h2>Recent matches for {history.account.username}</h2>
                {history.error ? <p role="alert">{history.error}</p> : !history.matches ? <p>Loading matches…</p> : (
                  <>
                    {history.ranked && <p>Ranked Elo {history.ranked.elo} · {history.ranked.wins} wins · {history.ranked.losses} losses · {history.ranked.draws} draws</p>}
                    <AdminTable columns={['Date', 'Result', 'Opponents', 'Room']}>
                      {history.matches.map(match => <tr key={match._id}>
                        <td>{dateTime(match.playedAt)}</td><td>{match.result}</td>
                        <td>{match.opponents.join(', ')}</td><td>{match.gameId}</td>
                      </tr>)}
                    </AdminTable>
                  </>
                )}
              </section>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function AdminTable({ columns, children }) {
  if (children.length === 0) return <p>No records found.</p>;
  return <div className="admin-table">
    <table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
