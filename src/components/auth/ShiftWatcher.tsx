import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Poll interval — short and self-correcting, unlike a single long-delay
// setTimeout which can silently be lost to tab freezing/throttling or the
// machine sleeping across a multi-hour gap.
const POLL_MS = 15_000;

/**
 * Automatically signs the current user out at shift-change times
 * (06:00 and 18:00 local time). Scoped to `role === "admin"` ONLY —
 * superuser / director / manager sessions are never force-logged-out
 * by this watcher. Mounted once at the application root.
 */
export function ShiftWatcher() {
  const { user, logout } = useAuth();
  const lastBoundaryRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user || user.role !== "admin") {
      lastBoundaryRef.current = null;
      return;
    }

    // The most recent shift boundary (06:00 or 18:00) that is <= now.
    const lastBoundaryAt = (d: Date) => {
      const candidates = [6, 18].map((h) => {
        const t = new Date(d);
        t.setHours(h, 0, 0, 0);
        if (t.getTime() > d.getTime()) t.setDate(t.getDate() - 1);
        return t.getTime();
      });
      return Math.max(...candidates);
    };

    const check = () => {
      const now = new Date();
      const boundary = lastBoundaryAt(now);

      if (lastBoundaryRef.current === null) {
        // First check this session: just remember which shift window
        // we're currently in — don't log out for a boundary that
        // already passed before this admin even logged in.
        lastBoundaryRef.current = boundary;
        return;
      }

      // A new boundary has been crossed since we last checked
      // (covers normal ticking AND catching up after the tab was
      // asleep/frozen/backgrounded through a 06:00 or 18:00 change).
      if (boundary > lastBoundaryRef.current) {
        lastBoundaryRef.current = boundary;
        logout();
      }
    };

    check();
    const intervalId = setInterval(check, POLL_MS);

    // Re-check immediately when the tab regains focus/visibility, so a
    // boundary crossed while backgrounded is caught right away instead
    // of waiting up to POLL_MS.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [user, logout]);

  return null;
}