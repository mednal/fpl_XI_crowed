"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MENU_GAP = 6;
const MENU_EDGE = 8;

/**
 * The little box that comes out of a shirt. Both pickers want it — a viewer
 * building an XI and a host rearranging their own team are asking the same
 * question of the same shirt — so the awkward half lives here once: it is
 * fixed, which means it has to be re-pinned to its anchor on every scroll or it
 * drifts across the page, and it flips above the shirt when there is no room
 * below, otherwise a bench player's menu opens past the bottom of the screen
 * where fixed positioning puts it out of reach.
 *
 * What the buttons *say* is the caller's business and stays there.
 */
export default function SlotMenu({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const pin = () => {
      const a = anchor.getBoundingClientRect();
      if (a.bottom < 0 || a.top > window.innerHeight) { onClose(); return; }
      const { width, height } = el.getBoundingClientRect();
      const below = a.bottom + MENU_GAP;
      const above = a.top - MENU_GAP - height;
      const top = below + height <= window.innerHeight - MENU_EDGE
        ? below
        : above >= MENU_EDGE
          ? above
          : Math.max(MENU_EDGE, window.innerHeight - MENU_EDGE - height);
      const left = Math.min(
        Math.max(MENU_EDGE, a.left + a.width / 2 - width / 2),
        Math.max(MENU_EDGE, window.innerWidth - MENU_EDGE - width),
      );
      setAt((cur) => (cur.left === left && cur.top === top ? cur : { left, top }));
    };

    pin();
    window.addEventListener("scroll", pin, true);
    window.addEventListener("resize", pin);
    return () => {
      window.removeEventListener("scroll", pin, true);
      window.removeEventListener("resize", pin);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="slotmenu" style={{ left: at.left, top: at.top }}>
      {children}
    </div>
  );
}

export function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onClick}>
      {children}
    </button>
  );
}
