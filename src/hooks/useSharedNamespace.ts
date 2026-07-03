import { useCallback } from 'react';
import { useSharedState, type HotelStateKey } from '@/lib/hotel-sync';

export type RecordMap = Record<string, Record<string, unknown>>;

/**
 * Syncs a record-map (keyed by bookingId) through the shared `hotel_app_state`
 * table — the SAME client-side engine bookings/grid/admins already use
 * (direct Supabase calls with the public anon key, RLS, and Realtime).
 * No server secrets required, so it works identically to everything else
 * that already syncs correctly across browsers.
 */
export function useSharedNamespace(key: HotelStateKey, eventName: string) {
  const { data, setData } = useSharedState<RecordMap>(key, {});

  const setRecord = useCallback(
    (id: string, record: Record<string, unknown>) => {
      setData((prev) => ({ ...(prev || {}), [id]: record }));
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName));
    },
    [setData, eventName],
  );

  return { map: data || {}, setRecord };
}