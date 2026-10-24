// src/components/AuthRedirectNotice.jsx
// After Google sign-in the server redirects back with ?auth=error (it could not finish signing the
// player in) or ?auth=cancelled (they backed out). Nothing used to read those, so a failed login
// just dropped the player on the home page, signed out, with no explanation.

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';

const MESSAGES = {
  error: { text: "Sign-in didn't complete. Please try again in a moment.", type: 'error' },
  cancelled: { text: 'Sign-in cancelled.', type: 'info' },
};

const AuthRedirectNotice = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('auth');
    if (!outcome || !MESSAGES[outcome]) return;
    showToast(MESSAGES[outcome].text, { type: MESSAGES[outcome].type, duration: 6000 });
    // Drop the flag so a refresh or a shared link does not show the message again
    params.delete('auth');
    const rest = params.toString();
    navigate(`${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate, showToast]);

  return null;
};

export default AuthRedirectNotice;
