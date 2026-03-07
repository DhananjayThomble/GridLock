import React from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket';

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI crashed in ErrorBoundary:', error, errorInfo);
  }

  handleReturnToLobby = () => {
    try {
      socket.removeAllListeners();
      if (socket.connected) {
        socket.disconnect();
      }
    } catch (e) {
      console.warn('Socket cleanup during crash recovery failed:', e);
    }

    this.setState({ hasError: false });
    this.props.onReturnToLobby();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 text-center shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="text-5xl mb-3">⚠️</div>
            <h2 className="text-2xl font-extrabold mb-2" style={{ color: 'var(--text-primary)' }}>Something went wrong</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              The game hit an unexpected issue. You can safely return to the lobby.
            </p>
            <button
              onClick={this.handleReturnToLobby}
              className="w-full py-3 rounded-xl font-bold text-sm text-white transition-colors"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Return to Lobby
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ErrorBoundary({ children }) {
  const navigate = useNavigate();

  const handleReturnToLobby = () => {
    // navigate() is sufficient for SPA routing — avoid the unnecessary full-page
    // reload that window.location.assign() would trigger.
    navigate('/', { replace: true });
  };

  return (
    <ErrorBoundaryInner onReturnToLobby={handleReturnToLobby}>
      {children}
    </ErrorBoundaryInner>
  );
}

export default ErrorBoundary;
