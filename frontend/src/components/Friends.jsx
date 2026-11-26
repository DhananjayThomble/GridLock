import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE } from '../config';

const api = API_BASE + '/api/friends';
const button = 'min-h-11 px-3 rounded-lg border text-sm font-semibold';

export default function Friends({ gameId, sessionToken, getSessionToken, onShare, collapsed = false }) {
  const { user, login } = useAuth();
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await axios.get(api, { signal: controller.signal });
        if (!controller.signal.aborted) setRows(result.data);
      } catch {
        if (!controller.signal.aborted) setMessage('Could not load friends. Try again shortly.');
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [user, revision]);

  async function act(operation, success) {
    setBusy(true);
    try {
      await operation();
      setMessage(success);
      setRevision(value => value + 1);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not complete the request. Please try again.');
    } finally { setBusy(false); }
  }

  if (collapsed) {
    const incoming = user ? rows.filter(row => row.gameId) : [];
    const requests = user ? rows.filter(row => row.status === 'received').length : 0;
    return <>
      {requests > 0 && <p className="px-4 text-sm">{requests} pending friend {requests === 1 ? 'request' : 'requests'}</p>}
      {incoming.map(row => <Link key={row.id} className={button + ' flex items-center'}
        to={'/join/' + row.gameId}>Join {row.name}’s game</Link>)}
    </>;
  }

  return <section aria-label="Friends" className="rounded-xl p-3 space-y-3 text-left" style={{background:'var(--bg-card)', color:'var(--text-primary)'}}>
    {onShare && <button className={button} onClick={onShare}>Share room link</button>}
    {user ? <>
      {!gameId && <Link to="/settings" className="inline-flex min-h-11 items-center underline text-sm">Manage invite notifications</Link>}
      <form className="flex flex-wrap gap-2" onSubmit={e => {
        e.preventDefault();
        act(() => axios.post(api, { username: name.trim() }), 'Friend request saved.');
      }}>
        <input className="min-w-0 flex-1 min-h-11 rounded-lg border px-2" aria-label="Friend’s username" placeholder="Friend’s username" value={name} maxLength={16} onChange={e => setName(e.target.value)} />
        <button className={button} disabled={busy || !name.trim()}>Add friend</button>
      </form>
      {rows.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2 border-t pt-2">
        <strong className="break-all">{row.name}</strong>
        {row.status === 'sent' && <span>Request sent</span>}
        {row.status === 'received' && <button disabled={busy} className={button} onClick={() => act(() => axios.post(api + '/' + row.id + '/accept'), 'Friend added.')}>Accept</button>}
        {row.gameId && <Link className={button + ' inline-flex items-center'} to={'/join/' + row.gameId}>Join game</Link>}
        {row.status === 'friend' && gameId && <button className={button} disabled={busy} onClick={() => act(() => axios.post(api + '/' + row.id + '/invite', {gameId, sessionToken: getSessionToken ? getSessionToken() : sessionToken}), 'Invitation sent to ' + row.name + '.')}>Invite</button>}
        <button className={button} disabled={busy} onClick={() => act(() => axios.delete(api + '/' + row.id), 'Removed.')}>{row.status === 'received' ? 'Decline' : row.status === 'sent' ? 'Cancel' : 'Remove'}</button>
      </div>)}
    </> : <button className={button} onClick={login}>Sign in to add and invite friends</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
