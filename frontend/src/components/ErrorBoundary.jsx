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
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white/10 border border-white/20 rounded-2xl p-6 text-center shadow-2xl">
            <div className="text-5xl mb-3">⚠️</div>
            <h2 className="text-2xl font-extrabold mb-2">Something went wrong</h2>
            <p className="text-white/70 text-sm mb-5">
              The game hit an unexpected issue. You can safely return to the lobby.
            </p>
            <button
              onClick={this.handleReturnToLobby}
              className="w-full py-3 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-500 transition-colors"
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
    const basePath = import.meta.env.BASE_URL || '/';
    navigate('/', { replace: true });
    window.location.assign(basePath);
  };

  return (
    <ErrorBoundaryInner onReturnToLobby={handleReturnToLobby}>
      {children}
    </ErrorBoundaryInner>
  );
}

export default ErrorBoundary;
