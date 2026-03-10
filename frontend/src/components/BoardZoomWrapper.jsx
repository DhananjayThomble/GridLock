import React, { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Wraps the game board with pinch-to-zoom and pan support.
 * - Two-finger pinch: zoom in/out (1x to 4x)
 * - One-finger drag (when zoomed > 1x): pan
 * - One-finger tap: passes through to line click handlers
 */
const BoardZoomWrapper = ({ children, enabled = true }) => {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isTouching, setIsTouching] = useState(false);
  const pinchRef = useRef({ initialDistance: 0, initialScale: 1 });
  const panRef = useRef({ startX: 0, startY: 0, startTranslateX: 0, startTranslateY: 0, moved: false });
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });

  // Keep refs in sync with state for use in event handlers
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { translateRef.current = translate; }, [translate]);

  const getDistance = useCallback((t1, t2) => {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }, []);

  const constrainTranslate = useCallback((tx, ty, s) => {
    if (s <= 1) return { x: 0, y: 0 };
    const container = containerRef.current;
    if (!container) return { x: tx, y: ty };
    const rect = container.getBoundingClientRect();
    // Allow panning up to half the container dimension beyond center
    const maxX = (rect.width * (s - 1)) / (2 * s);
    const maxY = (rect.height * (s - 1)) / (2 * s);
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }, []);

  const handleTouchStart = useCallback((e) => {
    setIsTouching(true);
    if (e.touches.length === 2) {
      // Pinch start
      const dist = getDistance(e.touches[0], e.touches[1]);
      pinchRef.current = { initialDistance: dist, initialScale: scaleRef.current };
    } else if (e.touches.length === 1 && scaleRef.current > 1) {
      // Pan start (only when zoomed)
      panRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTranslateX: translateRef.current.x,
        startTranslateY: translateRef.current.y,
        moved: false,
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
      setScale(newScale);
      scaleRef.current = newScale;

      // Constrain translation at new scale
      const constrained = constrainTranslate(translateRef.current.x, translateRef.current.y, newScale);
      setTranslate(constrained);
      translateRef.current = constrained;
    } else if (e.touches.length === 1 && scaleRef.current > 1) {
      // Pan
      const dx = (e.touches[0].clientX - panRef.current.startX) / scaleRef.current;
      const dy = (e.touches[0].clientY - panRef.current.startY) / scaleRef.current;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panRef.current.moved = true;
        e.preventDefault();
      }

      const newTx = panRef.current.startTranslateX + dx;
      const newTy = panRef.current.startTranslateY + dy;
      const constrained = constrainTranslate(newTx, newTy, scaleRef.current);
      setTranslate(constrained);
      translateRef.current = constrained;
    }
  }, [getDistance, constrainTranslate]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) {
      setIsTouching(false);
      // If scale snapped back to ~1, reset fully
      if (scaleRef.current < 1.05) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        scaleRef.current = 1;
        translateRef.current = { x: 0, y: 0 };
      }
    }
  }, []);

  const zoomIn = useCallback(() => {
    const newScale = Math.min(4, scaleRef.current + 0.5);
    setScale(newScale);
    scaleRef.current = newScale;
  }, []);

  const zoomOut = useCallback(() => {
    const newScale = Math.max(1, scaleRef.current - 0.5);
    setScale(newScale);
    scaleRef.current = newScale;
    if (newScale <= 1) {
      setTranslate({ x: 0, y: 0 });
      translateRef.current = { x: 0, y: 0 };
    } else {
      const constrained = constrainTranslate(translateRef.current.x, translateRef.current.y, newScale);
      setTranslate(constrained);
      translateRef.current = constrained;
    }
  }, [constrainTranslate]);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    scaleRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
  }, []);

  if (!enabled) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        overflow: 'hidden',
        touchAction: scale > 1 ? 'none' : 'pan-y',
        position: 'relative',
        width: '100%',
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
      {/* Zoom controls — always visible on touch devices */}
      <div
        className="zoom-controls"
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          zIndex: 50,
        }}
      >
        <button
          onClick={zoomIn}
          aria-label="Zoom in"
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            border: '1px solid var(--border-color)',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          +
        </button>
        <button
          onClick={zoomOut}
          aria-label="Zoom out"
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            border: '1px solid var(--border-color)',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          −
        </button>
        {scale > 1 && (
          <button
            onClick={resetZoom}
            aria-label="Reset zoom"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              borderRadius: '50%',
              width: 36,
              height: 36,
              border: '1px solid var(--border-color)',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
};

export default BoardZoomWrapper;
