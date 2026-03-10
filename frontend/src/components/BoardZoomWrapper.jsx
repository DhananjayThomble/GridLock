import React, { useRef, useCallback, useEffect, useReducer } from 'react';

/**
 * Wraps the game board with pinch-to-zoom and pan support.
 * - Two-finger pinch: zoom in/out (1x to 4x)
 * - One-finger drag (when zoomed > 1x): pan
 * - One-finger tap: passes through to line click handlers
 *
 * TODO: Add keyboard +/- zoom shortcuts for accessibility (issue #9).
 *       This component is mobile-focused; keyboard zoom is a known limitation.
 */

// Issue #6: Use useReducer instead of dual state+ref sync pattern
const initialZoomState = { scale: 1, translate: { x: 0, y: 0 }, isTouching: false };

function zoomReducer(state, action) {
  switch (action.type) {
    case 'SET_SCALE':
      return { ...state, scale: action.scale };
    case 'SET_TRANSLATE':
      return { ...state, translate: action.translate };
    case 'SET_TOUCHING':
      return { ...state, isTouching: action.isTouching };
    case 'UPDATE_GESTURE':
      return {
        ...state,
        scale: action.scale ?? state.scale,
        translate: action.translate ?? state.translate,
        isTouching: action.isTouching ?? state.isTouching,
      };
    case 'RESET':
      return initialZoomState;
    default:
      return state;
  }
}

const BoardZoomWrapper = ({ children, enabled = true, resetKey = false }) => {
  const containerRef = useRef(null);
  const [zoomState, dispatch] = useReducer(zoomReducer, initialZoomState);
  const { scale, translate, isTouching } = zoomState;

  // Refs = synchronous truth for gesture math (60fps touch handlers can't wait for React re-renders)
  // Reducer = React state for rendering (synced from refs after each gesture frame)
  const pinchRef = useRef({ initialDistance: 0, initialScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, startTranslateX: 0, startTranslateY: 0 });
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const rectRef = useRef(null);

  const getDistance = useCallback((t1, t2) => {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }, []);

  const constrainTranslate = useCallback((tx, ty, s) => {
    if (s <= 1) return { x: 0, y: 0 };
    const container = containerRef.current;
    if (!container) return { x: tx, y: ty };
    // Use cached rect from touchstart; fallback to live call
    const rect = rectRef.current || container.getBoundingClientRect();
    const maxX = (rect.width * (s - 1)) / (2 * s);
    const maxY = (rect.height * (s - 1)) / (2 * s);
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }, []);

  const handleTouchStart = useCallback((e) => {
    dispatch({ type: 'SET_TOUCHING', isTouching: true });
    // Cache container rect to avoid getBoundingClientRect() on every touchmove frame
    rectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    if (e.touches.length === 2) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      pinchRef.current = { initialDistance: dist, initialScale: scaleRef.current };
    } else if (e.touches.length === 1 && scaleRef.current > 1) {
      panRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTranslateX: translateRef.current.x,
        startTranslateY: translateRef.current.y,
      };
    }
  }, [getDistance]);

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2) {
      // Pinch zoom
      e.preventDefault();
      const dist = getDistance(e.touches[0], e.touches[1]);
      const newScale = Math.max(1, Math.min(4,
        pinchRef.current.initialScale * (dist / pinchRef.current.initialDistance)
      ));
      scaleRef.current = newScale;
      const constrained = constrainTranslate(translateRef.current.x, translateRef.current.y, newScale);
      translateRef.current = constrained;
      // Batch single state update
      dispatch({ type: 'UPDATE_GESTURE', scale: newScale, translate: constrained });
    } else if (e.touches.length === 1 && scaleRef.current > 1) {
      // Pan
      const dx = (e.touches[0].clientX - panRef.current.startX) / scaleRef.current;
      const dy = (e.touches[0].clientY - panRef.current.startY) / scaleRef.current;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        e.preventDefault();
      }

      const newTx = panRef.current.startTranslateX + dx;
      const newTy = panRef.current.startTranslateY + dy;
      const constrained = constrainTranslate(newTx, newTy, scaleRef.current);
      translateRef.current = constrained;
      dispatch({ type: 'SET_TRANSLATE', translate: constrained });
    }
  }, [getDistance, constrainTranslate]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) {
      if (scaleRef.current < 1.05) {
        scaleRef.current = 1;
        translateRef.current = { x: 0, y: 0 };
        dispatch({ type: 'RESET' });
      } else {
        dispatch({ type: 'SET_TOUCHING', isTouching: false });
      }
    }
  }, []);

  // Issue #1: Attach touch handlers with { passive: false } via useEffect
  // React registers touch handlers as passive — e.preventDefault() is silently ignored.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Issue #2: Reset zoom on orientation change so board doesn't pan off-screen
  useEffect(() => {
    const handleOrientationChange = () => {
      scaleRef.current = 1;
      translateRef.current = { x: 0, y: 0 };
      dispatch({ type: 'RESET' });
    };

    // Use both events for broad browser support
    window.addEventListener('orientationchange', handleOrientationChange);
    // Also listen to resize to catch orientation changes on browsers that
    // don't fire orientationchange (and re-constrain on window resize)
    const handleResize = () => {
      if (scaleRef.current > 1) {
        const constrained = constrainTranslate(
          translateRef.current.x, translateRef.current.y, scaleRef.current
        );
        translateRef.current = constrained;
        dispatch({ type: 'SET_TRANSLATE', translate: constrained });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleResize);
    };
  }, [constrainTranslate]);

  // Issue #3: Reset zoom when game ends so winner modal isn't under zoomed board
  useEffect(() => {
    if (resetKey) {
      scaleRef.current = 1;
      translateRef.current = { x: 0, y: 0 };
      dispatch({ type: 'RESET' });
    }
  }, [resetKey]);

  const zoomIn = useCallback(() => {
    const newScale = Math.min(4, scaleRef.current + 0.5);
    scaleRef.current = newScale;
    dispatch({ type: 'SET_SCALE', scale: newScale });
  }, []);

  const zoomOut = useCallback(() => {
    const newScale = Math.max(1, scaleRef.current - 0.5);
    scaleRef.current = newScale;
    if (newScale <= 1) {
      translateRef.current = { x: 0, y: 0 };
      dispatch({ type: 'RESET' });
    } else {
      const constrained = constrainTranslate(translateRef.current.x, translateRef.current.y, newScale);
      translateRef.current = constrained;
      dispatch({ type: 'UPDATE_GESTURE', scale: newScale, translate: constrained });
    }
  }, [constrainTranslate]);

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    dispatch({ type: 'RESET' });
  }, []);

  if (!enabled) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      style={{
        overflow: 'hidden',
        touchAction: scale > 1 ? 'none' : 'pan-y',
        position: 'relative',
        maxWidth: 'fit-content',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          transform: `scale(${scale}) translate(${translate.x}px, ${translate.y}px)`,
          transformOrigin: 'center center',
          transition: isTouching ? 'none' : 'transform 0.15s ease-out',
        }}
      >
        {children}
      </div>
      {/* Issue #10: Zoom controls — styles extracted to CSS classes in index.css */}
      <div className="zoom-controls">
        <button
          onClick={zoomIn}
          aria-label="Zoom in"
          className="zoom-btn"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          aria-label="Zoom out"
          className="zoom-btn"
        >
          −
        </button>
        {scale > 1 && (
          <button
            onClick={resetZoom}
            aria-label="Reset zoom"
            className="zoom-btn zoom-btn-reset"
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
};

export default BoardZoomWrapper;
