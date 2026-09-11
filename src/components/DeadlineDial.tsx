"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

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
 *
 * They hold that decision two ways round, so the panel holds two instruments.
 * One counts back from the deadline — stop it an hour early. The other is a
 * plain timer — you have an hour — and it is not measured against the deadline
 * at all: the gameweek's lock is only a ceiling it cannot pass. Neither is a
 * translation of the other while the host is talking to camera, and a pool
 * opened mid-segment is almost always the second.
 */

/** The runway snaps to five-minute marks. Epoch is aligned to the hour and every
 *  real UTC offset is a multiple of fifteen minutes, so these land on clean local
 *  times wherever the host is. */
const STEP_M = 5;
const STEP = STEP_M * 60_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Four jumps a host actually asks for, worded as distances. The way back to the
 *  deadline is its own control, because nudging there would be thirty-six
 *  presses. */
const QUICK: { label: string; before: number }[] = [
  { label: "5m", before: 5 * 60_000 },
  { label: "30m", before: 30 * 60_000 },
  { label: "1h", before: HOUR },
  { label: "3h", before: 3 * HOUR },
];

/** The same four jumps for the other timer, where they are lengths of pool
 *  rather than distances from the lock: how long the audience gets from now. */
const QUICK_FOR: { label: string; dur: number }[] = [
  { label: "15m", dur: 15 * 60_000 },
  { label: "30m", dur: 30 * 60_000 },
  { label: "1h", dur: HOUR },
  { label: "2h", dur: 2 * HOUR },
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

/** The timer's read-out: at most two units, and never a zero one — "1h 30m",
 *  "45m", "2h". It is the largest thing in the panel, so it may not change
 *  width as a unit drops out, which is what the tabular numerals are for. */
function figParts(ms: number): [number, string][] {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const out: [number, string][] = [];
  if (h) out.push([h, "h"]);
  if (m || !h) out.push([m, "m"]);
  return out;
}

/**
 * One column of a phone-style picker.
 *
 * The rows scroll under a band that never moves, and the value is whatever the
 * column comes to rest under — the gesture a host already knows from setting a
 * timer, and a bigger target mid-broadcast than a dropdown's option list. Every
 * row in it is an instant the runway already allows, so there is nothing here
 * that can be refused.
 *
 * Geometry is load-bearing: with two blank rows of padding at each end and five
 * rows of height on screen, row `i` sits under the band at exactly `i * ROW` of
 * scroll, which is what lets the column be read and driven by index alone.
 */
const ROW = 34;

function Wheel({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: { v: number; t: string; off?: boolean }[];
  value: number;
  onPick: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What the parent holds *now*, so a scroll that settles where it started
   *  stays silent rather than re-emitting the value it already has. */
  const held = useRef(value);
  held.current = value;

  const index = items.findIndex((i) => i.v === value);

  // Something else moved the answer — a drag on the runway, or a fall to the
  // nearest legal time — so the column follows it. When the move came from this
  // wheel it is already there, and this does nothing.
  useEffect(() => {
    const el = ref.current;
    if (!el || index < 0) return;
    const top = index * ROW;
    if (Math.abs(el.scrollTop - top) < 1) return;
    // Instantly, and that is not a shortcut. A column animating towards a value
    // is a column whose scroll position does not mean its value yet, and the
    // reader below cannot tell that from the host flicking it — three hours out
    // would settle wherever the slide happened to be when it looked.
    el.scrollTo({ top, behavior: "auto" });
  }, [index]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const settle = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
    const it = items[i];
    // Coming to rest on a row the ceiling has taken is not an answer, so the
    // column goes back to the one it left rather than quietly picking another.
    if (!it || it.off) {
      const back = items.findIndex((x) => x.v === held.current);
      if (back >= 0) el.scrollTo({ top: back * ROW, behavior: "smooth" });
      return;
    }
    if (it.v !== held.current) onPick(it.v);
  };

  function onKeyDown(e: React.KeyboardEvent) {
    let step: number | null = null;
    let from = index;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") step = -1;
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") step = 1;
    else if (e.key === "Home") { step = 1; from = -1; }
    else if (e.key === "End") { step = -1; from = items.length; }
    if (step === null) return;
    e.preventDefault();
    // Step over the rows the ceiling has taken rather than stopping dead on the
    // first of them, which is what a disabled option list does to a keyboard.
    for (let i = from + step; i >= 0 && i < items.length; i += step) {
      const it = items[i];
      if (it.off) continue;
      if (it.v !== value) onPick(it.v);
      return;
    }
  }

  return (
    <div className="wheel">
      <span className="wheelcap" aria-hidden="true">{label}</span>
      <div className="wheelbox">
        <div
          className="wheelscroll"
          ref={ref}
          role="listbox"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onScroll={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(settle, 110);
          }}
        >
          {items.map((it) => (
            <button
              key={it.v}
              type="button"
              role="option"
              aria-selected={it.v === value}
              disabled={it.off}
              tabIndex={-1}
              className={`wheelrow${it.v === value ? " on" : ""}`}
              onClick={() => { if (it.v !== value) onPick(it.v); }}
            >
              {it.t}
            </button>
          ))}
        </div>
        {/* The seat the answer sits in. It never moves; the rows move under it. */}
        <i className="wheelband" aria-hidden="true" />
      </div>
    </div>
  );
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
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Which way round the host is holding the question. */
  const [mode, setMode] = useState<"lead" | "for">("lead");
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

  /** The timer, and it is only a timer: a length counted from now, in the two
   *  columns a phone would use. The gameweek's lock is not its scale and not
   *  its zero — it is a ceiling, and the only thing it does here is grey out
   *  the rows beyond it.
   *
   *  Counted from the top of the current minute, so an hour closes on a whole
   *  minute rather than eleven seconds past one. */
  const base = now === null ? NaN : Math.floor(now / 60_000) * 60_000;
  const maxFor = room ? end - base : 0;
  /** The longest two columns can say. Past a day a host is not setting a timer
   *  any more, they are setting a closing time, and that is the other tab. */
  const FOR_CAP = 23 * HOUR + 55 * 60_000;
  const forCeil = Math.min(maxFor, FOR_CAP);
  /** No timer is a real state, not a length of zero: the pool runs the whole
   *  way to the lock, which is what an untouched pool has always done. */
  const forSet = room && !atEnd;
  const forMs = forSet
    ? Math.min(forCeil, Math.max(STEP, Math.round((target - base) / STEP) * STEP))
    : NaN;
  const forH = forSet ? Math.floor(forMs / HOUR) : -1;
  const forM = forSet ? Math.floor((forMs % HOUR) / 60_000 / STEP_M) * STEP_M : -1;

  /** Every row a timer has, always. A row the deadline has already swallowed is
   *  shown and disabled rather than missing: a column that silently stops at 22
   *  is one the host has to work out the reason for, on camera. */
  const forHourRows = () =>
    Array.from({ length: 24 }, (_, h) => ({
      v: h,
      t: String(h),
      off: h * HOUR > maxFor,
    }));
  const forMinRows = (h: number) => {
    const hours = Math.max(0, h) * HOUR;
    return Array.from({ length: 60 / STEP_M }, (_, i) => {
      const at = hours + i * STEP_M * 60_000;
      return {
        v: i * STEP_M,
        t: String(i * STEP_M).padStart(2, "0"),
        // Zero across both columns would shut the pool the moment it opened.
        off: at > maxFor || at < STEP,
      };
    });
  };

  /** Changing one column carries the other, falling to a legal row rather than
   *  leaving the host on a length the ceiling would refuse. With no timer set
   *  yet, an untouched column falls to its smallest value, not its largest:
   *  reaching for the minutes means half an hour, never twenty-two of them. */
  function pickFor(h: number, m: number) {
    const hs = forHourRows().filter((r) => !r.off);
    if (!hs.length) return;
    const h2 = hs.some((r) => r.v === h) ? h : (h < 0 ? hs[0] : hs[hs.length - 1]).v;
    const ms = forMinRows(h2).filter((r) => !r.off);
    if (!ms.length) return;
    const m2 = ms.some((r) => r.v === m) ? m : (m < 0 ? ms[0] : ms[ms.length - 1]).v;
    emitFor(h2 * HOUR + m2 * 60_000);
  }

  /** A timer ends when it ends. `emit` rounds up to a clean local mark, which
   *  is right for an instrument that names a time and wrong for one that names
   *  a length: it would quietly turn "an hour" into an hour and three minutes.
   *  So this keeps what the host set, and guards only the same five minutes of
   *  runway the rest of the panel does. */
  function emitFor(dur: number) {
    const t = Math.min(end, Math.max(base + STEP, base + dur));
    const iso = t >= end ? null : new Date(t).toISOString();
    onChange(iso);
    onCommit?.(iso);
  }

  /** The same answer held the other way round: not a clock time but a length —
   *  how long before the deadline voting stops, in the units a phone's timer
   *  uses. The runway's far end is the longest lead there is, so the columns
   *  simply run out where it does and nothing in them can be refused. */
  const maxLead = room ? end - min : 0;
  const maxD = Math.floor(maxLead / DAY);
  const lead = room
    ? Math.min(maxLead, Math.max(0, Math.round((end - target) / STEP) * STEP))
    : 0;
  const leadD = Math.floor(lead / DAY);
  const leadH = Math.floor((lead % DAY) / HOUR);
  const leadM = Math.floor((lead % HOUR) / 60_000 / STEP_M) * STEP_M;

  const leadHours = (d: number) => {
    const cap = d >= maxD ? Math.floor((maxLead - d * DAY) / HOUR) : 23;
    return Array.from({ length: Math.max(0, Math.min(23, cap)) + 1 }, (_, i) => i);
  };
  const leadMins = (d: number, h: number) => {
    const hs = leadHours(d);
    const last = d >= maxD && h >= hs[hs.length - 1];
    const cap = last ? Math.floor((maxLead - d * DAY - h * HOUR) / 60_000) : 59;
    const out: number[] = [];
    for (let m = 0; m <= Math.min(60 - STEP_M, cap); m += STEP_M) out.push(m);
    return out;
  };

  /** Changing one column carries the others, falling to the longest lead the
   *  runway still holds — the same rule as the clock, from the other side. */
  function pickLead(d: number, h: number, m: number) {
    const hs = leadHours(d);
    const h2 = hs.includes(h) ? h : hs[hs.length - 1];
    const ms = leadMins(d, h2);
    const m2 = ms.includes(m) ? m : ms[ms.length - 1];
    emit(end - (d * DAY + h2 * HOUR + m2 * 60_000), true);
  }

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
          {room ? (
            <>
              {/* Hosts hold this two ways round — "stop it an hour early" and
                  "you've got an hour" — and neither is a translation of the
                  other while they are talking to camera: the first is measured
                  from the deadline, the second from now. So the tab is the
                  question, and only the timer that answers it is on screen. */}
              <div className="dialtabs" role="tablist" aria-label="How to set the closing time">
                <button
                  type="button"
                  role="tab"
                  id={`${uid}-tab-lead`}
                  aria-selected={mode === "lead"}
                  aria-controls={`${uid}-body-lead`}
                  className={`dialtab${mode === "lead" ? " on" : ""}`}
                  onClick={() => setMode("lead")}
                >
                  Before the deadline
                </button>
                <button
                  type="button"
                  role="tab"
                  id={`${uid}-tab-for`}
                  aria-selected={mode === "for"}
                  aria-controls={`${uid}-body-for`}
                  className={`dialtab${mode === "for" ? " on" : ""}`}
                  onClick={() => setMode("for")}
                >
                  Open for
                </button>
              </div>

              {mode === "lead" ? (
                <div
                  className="dialtabbody"
                  id={`${uid}-body-lead`}
                  role="tabpanel"
                  aria-labelledby={`${uid}-tab-lead`}
                >
                  {/* A timer, the way a phone asks for one: the columns are the
                      units, and what they add up to is how long before the
                      deadline voting stops. Zero across is the deadline itself,
                      which is also what the wide chip below returns to. */}
                  <div className={`dialtimer${maxD ? " three" : ""}`}>
                    {maxD > 0 && (
                      <Wheel
                        label="Days"
                        items={Array.from({ length: maxD + 1 }, (_, i) => ({ v: i, t: String(i) }))}
                        value={leadD}
                        onPick={(d) => pickLead(d, leadH, leadM)}
                      />
                    )}
                    <Wheel
                      label="Hours"
                      items={leadHours(leadD).map((h) => ({ v: h, t: String(h) }))}
                      value={leadH}
                      onPick={(h) => pickLead(leadD, h, leadM)}
                    />
                    <Wheel
                      label="Min"
                      items={leadMins(leadD, leadH).map((m) => ({
                        v: m,
                        t: String(m).padStart(2, "0"),
                      }))}
                      value={leadM}
                      onPick={(m) => pickLead(leadD, leadH, m)}
                    />
                  </div>

                  <div className="dialquick">
                    {QUICK.map((q) => {
                      const at = end - q.before;
                      return (
                        <button
                          key={q.label}
                          type="button"
                          className={`pchip${!atEnd && Math.abs(target - at) < STEP ? " on" : ""}`}
                          disabled={at < min}
                          onClick={() => emit(at, true)}
                        >
                          {q.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Nudging home from three hours out would be thirty-six
                      presses, so the way back stays one. */}
                  <button
                    type="button"
                    className={`pchip wide${atEnd ? " on" : ""}`}
                    onClick={() => emit(end, true)}
                  >
                    At the deadline
                  </button>
                </div>
              ) : (
                <div
                  className="dialtabbody"
                  id={`${uid}-body-for`}
                  role="tabpanel"
                  aria-labelledby={`${uid}-tab-for`}
                >
                  {/* The length is the answer, so the length is the headline and
                      the columns under it are only how it is changed. */}
                  <div className="dialread">
                    <b className={`dialfig${forSet ? "" : " off"}`}>
                      {forSet
                        ? figParts(forMs).map(([n, u]) => (
                            <Fragment key={u}>{n}<i>{u}</i></Fragment>
                          ))
                        : "No timer"}
                    </b>
                    <span className="dialclose">
                      {forSet ? (
                        <>Closes <b>{fmtTime(target)}</b></>
                      ) : (
                        <>Runs to the {endLabel}, <b>{fmtTime(end)}</b></>
                      )}
                    </span>
                  </div>

                  <div className="dialtimer">
                    <Wheel
                      label="Hours"
                      items={forHourRows()}
                      value={forH}
                      onPick={(h) => pickFor(h, forM)}
                    />
                    <Wheel
                      label="Min"
                      items={forMinRows(forH)}
                      value={forM}
                      onPick={(m) => pickFor(forH, m)}
                    />
                  </div>

                  <div className="dialquick">
                    {QUICK_FOR.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        className={`pchip${
                          forSet && Math.abs(target - (base + q.dur)) < STEP ? " on" : ""
                        }`}
                        disabled={base + q.dur > end}
                        onClick={() => emitFor(q.dur)}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>

                  {/* The lock, said once, at the bottom, in the only place it
                      has any business in a timer: where the timer runs out of
                      room. Past a day it is the columns that run out first, and
                      then the sentence points at the tab that does not. */}
                  <p className="dialcap">
                    {maxFor <= FOR_CAP ? (
                      <>
                        Anything up to <b>{gapText(forCeil)}</b>, which is where the {endLabel}
                        {" "}stops it.
                      </>
                    ) : (
                      <>
                        Anything up to <b>{gapText(FOR_CAP)}</b>. For longer, set it against the
                        {" "}deadline on the other tab.
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* The runway is the scale a deadline-relative answer lands on, so
                  it stays with the tab that gives one. Under the timer it would
                  be the wrong ruler: a length has no business being drawn
                  against the lock it is not measured from. */}
              {mode === "lead" && (
                <>
                  <div
                    className={`dialtrack slim${dragging ? " dragging" : ""}`}
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

                {/* Both readings at once: the clock the host will say out loud, and
                    what it costs against the deadline. The timer says its own
                    two under the figure, so this belongs to this tab alone. */}
                <p className="dialsay">
                  Voting closes <b>{fmtDay(target)}, {fmtTime(target)}</b>
                  {atEnd
                    ? ` — the ${endLabel} itself.`
                    : ` — ${gapText(end - target)} before the ${endLabel}.`}
                </p>
                </>
              )}

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
