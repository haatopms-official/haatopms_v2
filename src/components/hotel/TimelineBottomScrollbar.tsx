import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

interface Props {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  labelWidth: number;
  todayContentPx: number;
  onDragStateChange?: (dragging: boolean) => void;
  onEdgeRequest?: (direction: 'past' | 'future') => void;
}

const MIN_THUMB_WIDTH = 56;       // floor — never disappears
const MAX_THUMB_WIDTH_RATIO = 0.3; // at today
const EDGE_AUTOSCROLL_STEP = 32;
const EDGE_REQUEST_INTERVAL_MS = 180;
const PROXIMITY_RANGE_PX = 4000;   // distance over which thumb breathes

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) => t * t * (3 - 2 * t);

export function TimelineBottomScrollbar({
  scrollRef,
  labelWidth,
  todayContentPx,
  onDragStateChange,
  onEdgeRequest,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, scrollWidth: 1, clientWidth: 1 });
  const [trackWidth, setTrackWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const activeDragRef = useRef(false);

  /** Thumb width breathes by distance from today (in pixels), not by ratio of content. */
  const computeThumbWidth = useCallback((scrollLeft: number, clientWidth: number) => {
    const viewport = Math.max(1, clientWidth - labelWidth);
    const viewportCenter = scrollLeft + viewport / 2;
    const distance = Math.abs(viewportCenter - todayContentPx);
    const proximity = clamp(1 - distance / PROXIMITY_RANGE_PX, 0, 1);
    const eased = easeInOut(proximity);
    const maxWidth = Math.max(MIN_THUMB_WIDTH + 40, Math.round(trackWidth * MAX_THUMB_WIDTH_RATIO));
    const width = MIN_THUMB_WIDTH + (maxWidth - MIN_THUMB_WIDTH) * eased;
    return Math.round(Math.max(MIN_THUMB_WIDTH, Math.min(trackWidth - 8, width)));
  }, [labelWidth, todayContentPx, trackWidth]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el || activeDragRef.current) return;
    setMetrics({ scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    window.addEventListener('resize', schedule);
    return () => {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, measure]);

  useLayoutEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    ro.observe(trackRef.current);
    setTrackWidth(trackRef.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const viewport = Math.max(1, metrics.clientWidth - labelWidth);
  const maxScroll = Math.max(1, metrics.scrollWidth - metrics.clientWidth);
  const liveThumbWidth = trackWidth > 0 ? computeThumbWidth(metrics.scrollLeft, metrics.clientWidth) : MIN_THUMB_WIDTH;
  const maxThumbLeft = Math.max(0, trackWidth - liveThumbWidth - 8);
  const liveThumbLeft = clamp((metrics.scrollLeft / maxScroll) * maxThumbLeft, 0, maxThumbLeft);

  const onThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !trackRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    activeDragRef.current = true;
    setDragging(true);
    onDragStateChange?.(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }

    let pointerX = e.clientX;
    let lastPointerX = e.clientX;
    let targetScroll = el.scrollLeft;
    let lastScrollWidth = el.scrollWidth;
    let lastScrollLeft = el.scrollLeft;
    let edgeDir: 'past' | 'future' | null = null;
    let lastEdgeReqAt = 0;
    let raf = 0;

    const writeThumb = (left: number, width: number) => {
      if (!thumbRef.current) return;
      thumbRef.current.style.width = `${width}px`;
      thumbRef.current.style.transform = `translate3d(${left + 4}px, -50%, 0)`;
    };

    const requestEdge = (dir: 'past' | 'future') => {
      const now = performance.now();
      if (now - lastEdgeReqAt < EDGE_REQUEST_INTERVAL_MS) return;
      lastEdgeReqAt = now;
      onEdgeRequest?.(dir);
    };

    const tick = () => {
      if (!activeDragRef.current) return;

      // Compensate prepend: when scrollWidth grew and scrollLeft jumped, anchor target.
      const widthDelta = el.scrollWidth - lastScrollWidth;
      const leftDelta = el.scrollLeft - lastScrollLeft;
      if (widthDelta > 0 && leftDelta > widthDelta * 0.4) {
        targetScroll += widthDelta;
      }

      const trackLen = trackRef.current?.getBoundingClientRect().width ?? trackWidth;
      const liveWidth = computeThumbWidth(targetScroll, el.clientWidth);
      const usableTrack = Math.max(1, trackLen - liveWidth - 8);
      const maxScrollNow = Math.max(1, el.scrollWidth - el.clientWidth);

      const dx = pointerX - lastPointerX;
      lastPointerX = pointerX;
      if (dx !== 0) {
        targetScroll += (dx / usableTrack) * maxScrollNow;
      }

      if (edgeDir === 'future') {
        targetScroll = Math.min(maxScrollNow, targetScroll + EDGE_AUTOSCROLL_STEP);
        requestEdge('future');
      } else if (edgeDir === 'past') {
        targetScroll = Math.max(0, targetScroll - EDGE_AUTOSCROLL_STEP);
        requestEdge('past');
      }

      targetScroll = clamp(targetScroll, 0, maxScrollNow);
      el.scrollLeft = targetScroll;

      const visualLeft = clamp((targetScroll / maxScrollNow) * usableTrack, 0, usableTrack);
      writeThumb(visualLeft, liveWidth);

      edgeDir = visualLeft <= 1 ? 'past' : visualLeft >= usableTrack - 1 ? 'future' : null;

      lastScrollWidth = el.scrollWidth;
      lastScrollLeft = el.scrollLeft;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => { ev.preventDefault(); pointerX = ev.clientX; };
    const up = (ev: PointerEvent) => {
      activeDragRef.current = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (thumbRef.current) {
        thumbRef.current.style.width = '';
        thumbRef.current.style.transform = '';
      }
      setMetrics({ scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      setDragging(false);
      onDragStateChange?.(false);
      try { (e.target as HTMLElement).releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [scrollRef, trackWidth, computeThumbWidth, onDragStateChange, onEdgeRequest]);

  const onTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    const el = scrollRef.current;
    if (!el || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - liveThumbWidth / 2;
    const usable = Math.max(1, trackWidth - liveThumbWidth - 8);
    const clamped = clamp(x, 0, usable);
    const target = (clamped / usable) * (el.scrollWidth - el.clientWidth);
    el.scrollTo({ left: target, behavior: 'smooth' });
  }, [scrollRef, liveThumbWidth, trackWidth]);

  useEffect(() => () => { activeDragRef.current = false; onDragStateChange?.(false); }, [onDragStateChange]);

  const hidden = metrics.scrollWidth <= viewport + labelWidth + 4;

  return (
    <div
      className="sticky bottom-0 z-40 flex w-full select-none border-t border-border/40 bg-gradient-to-b from-background/70 to-background backdrop-blur-md"
      style={{
        height: 24,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 200ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ width: labelWidth }} className="shrink-0" />
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative flex-1 cursor-pointer"
        style={{ touchAction: 'none' }}
      >
        <div
          className="absolute left-1 right-1 top-1/2 -translate-y-1/2 rounded-full bg-muted/60 ring-1 ring-border/60"
          style={{
            height: hovered || dragging ? 10 : 6,
            transition: dragging ? 'none' : 'height 140ms ease',
          }}
        />
        <div
          ref={thumbRef}
          onPointerDown={onThumbPointerDown}
          role="scrollbar"
          aria-orientation="horizontal"
          aria-valuenow={Math.round((metrics.scrollLeft / maxScroll) * 100) || 0}
          className="absolute top-1/2 cursor-grab rounded-full bg-gradient-to-b from-primary to-primary/80 shadow-md ring-1 ring-primary/40 active:cursor-grabbing"
          style={{
            left: 0,
            transform: `translate3d(${liveThumbLeft + 4}px, -50%, 0)`,
            width: liveThumbWidth,
            height: hovered || dragging ? 14 : 10,
            transition: dragging
              ? 'none'
              : 'width 260ms cubic-bezier(.22,.61,.36,1), transform 180ms cubic-bezier(.22,.61,.36,1), height 160ms ease, box-shadow 160ms ease',
            boxShadow: dragging || hovered
              ? '0 4px 14px -2px color-mix(in oklab, hsl(var(--primary)) 55%, transparent)'
              : '0 2px 6px -1px color-mix(in oklab, hsl(var(--primary)) 30%, transparent)',
            touchAction: 'none',
            willChange: dragging ? 'transform, width' : 'transform',
          }}
        />
      </div>
    </div>
  );
}
