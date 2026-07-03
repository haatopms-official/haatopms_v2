import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Booking, BookingSegment } from '@/types/hotel';

/**
 * Per-night rate for a room category, mirroring the auto-calc used in the
 * Edit/New booking modal so a split at drag-time produces the same numbers
 * the user would have seen creating a fresh booking in that category.
 */
export function computePerNightRate(
  categoryRates: Record<string, { resident?: number[]; nonResident?: number[] } | undefined>,
  categoryId: string,
  residency: 'resident' | 'nonResident',
  guestCount: number,
): number {
  if (!categoryId) return 0;
  const arr = (categoryRates[categoryId]?.[residency] ?? []) as number[];
  if (!arr || arr.length === 0) return 0;
  const n = Math.max(1, Number(guestCount) || 1);
  const maxG = arr.length;
  const within = Math.min(n, maxG);
  const base = Number(arr[within - 1]) || 0;
  const extras = Math.max(0, n - maxG);
  const extraRate = Number(arr[0]) || 0;
  return base + extras * extraRate;
}

/** Nights count between two yyyy-MM-dd ISO dates (half-open). Never negative. */
export function nightsBetween(fromIso: string, toIso: string): number {
  try {
    return Math.max(0, differenceInCalendarDays(parseISO(toIso), parseISO(fromIso)));
  } catch {
    return 0;
  }
}

/**
 * Build a fresh segment from parameters. Rounds the leg price to a whole
 * number (matches existing price-input rounding in the app).
 */
export function buildSegment(params: {
  roomNumber: number;
  categoryId: string;
  from: string;
  to: string;
  guestCount: number;
  perNightRate: number;
}): BookingSegment {
  const nights = nightsBetween(params.from, params.to);
  const price = Math.round(nights * params.perNightRate);
  return {
    roomNumber: params.roomNumber,
    categoryId: params.categoryId,
    from: params.from,
    to: params.to,
    nights,
    guestCount: params.guestCount,
    perNightRate: params.perNightRate,
    price,
  };
}

/** Sum of segment prices, or 0 when there are no segments. */
export function sumSegments(segments?: BookingSegment[] | null): number {
  if (!segments || segments.length === 0) return 0;
  return segments.reduce((s, seg) => s + (Number(seg.price) || 0), 0);
}

/**
 * Split (or extend) a booking's segments at `splitDate` when the guest is
 * moved into a room of a different category mid-stay. Returns null when the
 * split is a no-op (bad date bounds).
 *
 * Behavior:
 * - No existing segments: create two — original room from checkIn→splitDate,
 *   new room from splitDate→checkOut.
 * - Existing segments: clip the last segment to end at splitDate (recomputing
 *   its price) and append a new segment for the new room from splitDate→checkOut.
 */
export function splitBookingAt(params: {
  booking: Booking;
  splitDate: string;
  newRoomNumber: number;
  newCategoryId: string;
  oldCategoryId: string;
  residency: 'resident' | 'nonResident';
  categoryRates: Record<string, { resident?: number[]; nonResident?: number[] } | undefined>;
}): BookingSegment[] | null {
  const { booking, splitDate, newRoomNumber, newCategoryId, oldCategoryId, residency, categoryRates } = params;
  const checkIn = booking.checkIn;
  const checkOut = booking.checkOut;
  if (!checkIn || !checkOut) return null;
  // Clamp split date strictly inside [checkIn, checkOut] so both legs have >= 1 night.
  const maxSplitDays = nightsBetween(checkIn, checkOut) - 1;
  if (maxSplitDays < 1) return null;
  const splitNights = nightsBetween(checkIn, splitDate);
  const clampedNights = Math.min(Math.max(splitNights, 1), maxSplitDays);
  const boundary = (() => {
    const d = parseISO(checkIn);
    d.setDate(d.getDate() + clampedNights);
    return d.toISOString().slice(0, 10);
  })();

  const guestCount = Math.max(1, booking.guestCount || 1);
  const existing = booking.segments ? [...booking.segments] : null;

  const newSegment = buildSegment({
    roomNumber: newRoomNumber,
    categoryId: newCategoryId,
    from: boundary,
    to: checkOut,
    guestCount,
    perNightRate: computePerNightRate(categoryRates, newCategoryId, residency, guestCount),
  });

  if (!existing) {
    const oldSegment = buildSegment({
      roomNumber: booking.roomNumber,
      categoryId: oldCategoryId,
      from: checkIn,
      to: boundary,
      guestCount,
      perNightRate: computePerNightRate(categoryRates, oldCategoryId, residency, guestCount),
    });
    return [oldSegment, newSegment];
  }

  const clipped: BookingSegment[] = [];
  for (const seg of existing) {
    if (seg.to <= boundary) { clipped.push(seg); continue; }
    if (seg.from >= boundary) continue;
    clipped.push(buildSegment({
      roomNumber: seg.roomNumber,
      categoryId: seg.categoryId,
      from: seg.from,
      to: boundary,
      guestCount: seg.guestCount,
      perNightRate: seg.perNightRate,
    }));
  }
  clipped.push(newSegment);
  return clipped;
}
