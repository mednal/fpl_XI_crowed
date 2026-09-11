"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * When the pool stops taking teams.
 *
 * Not a calendar. A pool is pinned to one gameweek and dies at its deadline, so
 * the only legal closing times are the minutes between now and that deadline —
 * a month grid would offer thirty days of which twenty-nine are refused. The
 * runway *is* the domain instead: the track spans now to the deadline, so it
 * rescales itself as the moment approaches, and every position on it is legal.
 *
 * The host is mid-broadcast when they reach for this, talking to camera with one
 * hand free, and what they are deciding is not a date but how much of the runway
 * to use — which is why the reading beside the clock is the distance from the
 * deadline, and why the presets are worded that way too.
 */

/** The runway snaps to five-minute marks. Epoch is aligned to the hour and every
 *  real UTC offset is a multiple of fifteen minutes, so these land on clean local
 *  times wherever the host is. */
const STEP = 5 * 60_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Day names on the track stop being readable somewhere past four of them. */
const LABELLED_TICKS = 4 * DAY;

const PRESETS: { label: string; before: number }[] = [
  { label: "At the deadline", before: 0 },
  { label: "15m before", before: 15 * 60_000 },
  { label: "1h before", before: HOUR },
  { label: "3h before", before: 3 * HOUR },
];

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/** The same voice as the strip's countdown — days and hours, then hours and
 *  minutes, then minutes — except that a chosen time lands on a round hour far
 *  more often than a ticking one does, and "1h 0m before the deadline" is not a
 *  sentence anybody says. */
function gapText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export default function DeadlineDial({
  label,
  value,
  deadline,
  endLabel = "FPL deadline",
  variant = "overlay",
  disabled = false,
  onChange,
  onCommit,
  footer,
}: {
  /** The trigger's accessible name: what it reads out as, since what it shows is
   *  a time rather than a word. */
  label: string;
  /** The chosen instant, or null for "at the deadline" — which is the default,
   *  and what an empty value has always meant to the server. */
  value: string | null;
  /** The gameweek's own lock: the hard right-hand end of the runway. */
  deadline: string | null;
  endLabel?: string;
  /** `inline` grows the layout it sits in; `overlay` floats over it, which is
   *  what the broadcast board needs — nothing may push the pitch. */
  variant?: "inline" | "overlay";
  disabled?: boolean;
  onChange: (iso: string | null) => void;
  /** Fired when the gesture settles: a released drag, a lifted key, a preset. */
  onCommit?: (iso: string | null) => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Null until the browser has said what time it is and which zone it keeps.
  // Both differ from the server's, and rendering either on the first pass is a
  // hydration mismatch.
  const [now, setNow] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const trigRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const end = deadline ? Date.parse(deadline) : NaN;
  const hasEnd = Number.isFinite(end);
  const target = value ? Date.parse(value) : end;

  // The left end is the next five-minute mark a clear five minutes out: sliding
  // all the way down should leave the host a pool, not shut one. Shutting it now
  // is a different button, and it says so.
  const min = now === null ? NaN : Math.ceil((now + STEP) / STEP) * STEP;
  const span = now === null || !hasEnd ? 0 : end - now;
  const room = Number.isFinite(min) && hasEnd && end > min;

  // The runway is not drawn to scale, and that is the point. Drawn linearly, a
  // deadline three days out would push every adjustment a host actually makes —
  // minutes and hours, never days — into the last two per cent of the track.
  // So distance is measured back from the deadline on a curve whose bend tracks
  // how long the runway is: a three-hour runway comes out nearly straight, a
  // week-long one leans hard on its final hours, and "an hour before" lands in
  // roughly the same place either way. The day marks bunch to the left under the
  // same transform, which is what tells the reader the scale is not uniform.
  const power = span > 0 ? 1 / (1 + Math.log2(1 + span / DAY)) : 1;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const toF = (t: number) => (span > 0 ? 1 - Math.pow(clamp01((end - t) / span), power) : 1);
  const toT = (f: number) => end - span * Math.pow(1 - clamp01(f), 1 / power);

  const fraction = span > 0 && Number.isFinite(target) ? toF(target) : 1;
  const atEnd = !Number.isFinite(target) || target >= end;

  const ticks = useMemo(() => {
    if (now === null || !hasEnd || span <= DAY) return [];
    const out: { at: number; f: number; label: string }[] = [];
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    while (d.getTime() < end && out.length < 8) {
      out.push({
        at: d.getTime(),
        f: toF(d.getTime()),
        label: d.toLocaleDateString([], { weekday: "short" }),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, end, span, hasEnd, power]);

  function emit(t: number, settle: boolean) {
    const clamped = Math.min(end, Math.max(min, t));
    const iso = clamped >= end ? null : new Date(clamped).toISOString();
    onChange(iso);
    if (settle) onCommit?.(iso);
  }

  function pointTo(clientX: number, settle: boolean) {
    const el = trackRef.current;
    if (!el || now === null || !room) return;
    const r = el.getBoundingClientRect();
    const f = clamp01((clientX - r.left) / r.width);
    emit(Math.round(toT(f) / STEP) * STEP, settle);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!room || now === null) return;
    const step = e.shiftKey ? 12 * STEP : STEP;
    const base = Number.isFinite(target) ? target : end;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base + step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = end;
    if (next === null) return;
    e.preventDefault();
    emit(next, true);
  }

  // Escape and a click outside both dismiss, and the trigger takes focus back —
  // a host who opened this from the keyboard is not left at the top of the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open) handleRef.current?.focus();
  }, [open]);

  const ready = now !== null && hasEnd;
  const relText = atEnd
    ? "Runs to the gameweek deadline."
    : `Closes ${gapText(end - target)} before the deadline.`;

  return (
    <div className={`dial dial-${variant}${open ? " open" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="dialtrig"
        ref={trigRef}
        aria-label={ready ? `${label}: ${fmtDay(target)} ${fmtTime(target)}` : label}
        disabled={disabled || !hasEnd}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {ready ? (
          <>
            <span className="lab">{fmtDay(target)}</span>
            <b className="num">{fmtTime(target)}</b>
            <span className="spacer" />
          </>
        ) : (
          <span className="lab">Closing time</span>
        )}
        <svg className="dialcaret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8 9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>

      {open && (
        <div className="dialpanel" role="dialog" aria-label="When voting closes">
          {/* The trigger sits directly above and already reads the clock in
              Anton. Repeating it here, larger, would be the same fact twice; the
              panel says what the position means instead. */}
          <p className="dialsay">{ready ? relText : "The gameweek deadline could not be read."}</p>

          {room ? (
            <>
              <div
                className={`dialtrack${dragging ? " dragging" : ""}`}
                ref={trackRef}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDragging(true);
                  pointTo(e.clientX, false);
                }}
                onPointerMove={(e) => { if (dragging) pointTo(e.clientX, false); }}
                onPointerUp={(e) => {
                  if (!dragging) return;
                  setDragging(false);
                  pointTo(e.clientX, true);
                }}
                onPointerCancel={() => setDragging(false)}
              >
                <div className="dialrail">
                  <i className="dialfill" style={{ transform: `scaleX(${fraction})` }} />
                  {ticks.map((t) => (
                    <i key={t.at} className="dialtick" style={{ left: `${t.f * 100}%` }} />
                  ))}
                  <i className="dialstop" />
                </div>

                {span <= LABELLED_TICKS &&
                  ticks
                    // A name centred on a mark this close to an end has nowhere
                    // to sit; the hairline still marks the day.
                    .filter((t) => t.f > 0.08 && t.f < 0.9)
                    .map((t) => (
                      <span key={t.at} className="dialday lab" style={{ left: `${t.f * 100}%` }}>
                        {t.label}
                      </span>
                    ))}

                <div
                  className="dialhandle"
                  ref={handleRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Closing time"
                  aria-valuemin={min}
                  aria-valuemax={end}
                  aria-valuenow={Number.isFinite(target) ? target : end}
                  aria-valuetext={`${fmtDay(target)} ${fmtTime(target)}. ${relText}`}
                  style={{ left: `${fraction * 100}%` }}
                  onKeyDown={onKeyDown}
                />
              </div>

              <div className="dialends">
                <span className="lab">Now</span>
                <span className="spacer" />
                <span className="lab stop">{endLabel}</span>
              </div>

              <div className="dialsets">
                {PRESETS.map((p) => {
                  const at = end - p.before;
                  const on = p.before === 0 ? atEnd : !atEnd && Math.abs(target - at) < STEP;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`pchip${on ? " on" : ""}`}
                      disabled={at < min}
                      onClick={() => emit(at, true)}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="dialnote">
              {hasEnd
                ? "Under five minutes are left before the deadline, so there is no runway to set. Close the pool by hand instead."
                : "The gameweek deadline could not be read, so a closing time cannot be set here."}
            </p>
          )}

          {footer && <div className="dialfoot">{footer}</div>}
        </div>
      )}
    </div>
  );
}
