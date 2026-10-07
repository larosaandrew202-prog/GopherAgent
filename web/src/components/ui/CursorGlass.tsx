import { useEffect, useRef, useState } from 'react';
import { LiquidGlassFilter, useLiquidGlass } from './LiquidGlass';

/** Diameter of the following lens, in px. */
const SIZE = 150;
const STORAGE_KEY = 'gopher_cursor_glass';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Elements that accept typing or open a chooser; while one is focused the lens
 *  would sit over the caret / options, so it is hidden. */
const FIELD_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="listbox"]',
  '[role="spinbutton"]',
].join(',');

const FIELD_WRAPPER = [
  '.ant-select',
  '.ant-picker',
  '.ant-input-number',
  '.ant-cascader',
  '.ant-tree-select',
  '.ant-mentions',
].join(',');

function isEditingElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el.matches(FIELD_SELECTOR)) return true;
  return !!el.closest(FIELD_WRAPPER);
}

function isEditing(): boolean {
  if (isEditingElement(document.activeElement)) return true;
  // An open antd select/picker popup counts even if focus has moved to its list.
  return !!document.querySelector('.ant-select-open, .ant-picker-open, .ant-dropdown-open');
}

/**
 * A liquid-glass lens that follows the pointer, adapted from shuding/liquid-glass.
 *
 *  - Chromium-only (`backdrop-filter: url(#filter)`); other engines just don't
 *    render it. It is `pointer-events: none`, so it never blocks interaction.
 *  - It refracts whatever is painted behind it, so it reads best over text and
 *    other detailed content; over flat colour it is nearly invisible.
 *  - Toggle with Ctrl/Cmd + Shift + G (persisted). Skipped on touch-only devices.
 */
export function CursorGlass() {
  const glass = useLiquidGlass({
    width: SIZE,
    height: SIZE,
    ring: 34,
    pull: 26,
    blur: 0.5,
    shape: 'circle',
    saturate: 114,
    brightness: 1.0,
  });
  const [enabled, setEnabled] = useState(readEnabled);
  const [active, setActive] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -SIZE, y: -SIZE });
  const pos = useRef({ x: -SIZE, y: -SIZE });
  const raf = useRef(0);
  const moved = useRef(false);

  // Ctrl/Cmd + Shift + G toggles the effect on and off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setEnabled((v) => {
          writeEnabled(!v);
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hide while a text field or a dropdown/select has focus, so the lens never
  // sits over the caret or the open options.
  useEffect(() => {
    const update = () => setSuppressed(isEditing());
    // focusout fires before the next element receives focus; defer so
    // document.activeElement is settled.
    const onFocusOut = () => window.setTimeout(update, 0);
    document.addEventListener('focusin', update, true);
    document.addEventListener('focusout', onFocusOut, true);
    update();
    return () => {
      document.removeEventListener('focusin', update, true);
      document.removeEventListener('focusout', onFocusOut, true);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return;
    }
    // There is no hovering pointer to follow on a touch-only device.
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) {
      return;
    }

    const step = () => {
      raf.current = 0;
      const p = pos.current;
      const t = target.current;
      p.x += (t.x - p.x) * 0.24;
      p.y += (t.y - p.y) * 0.24;
      const el = ref.current;
      if (el) {
        el.style.transform = `translate3d(${p.x - SIZE / 2}px, ${p.y - SIZE / 2}px, 0)`;
      }
      if (Math.abs(t.x - p.x) > 0.15 || Math.abs(t.y - p.y) > 0.15) {
        raf.current = requestAnimationFrame(step);
      }
    };
    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      target.current = { x: e.clientX, y: e.clientY };
      if (!moved.current) {
        // First sighting: snap instead of flying in from off-screen.
        moved.current = true;
        pos.current = { x: e.clientX, y: e.clientY };
        setActive(true);
      }
      schedule();
    };
    const onLeave = () => setActive(false);
    const onEnter = () => {
      if (moved.current) setActive(true);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseenter', onEnter);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseenter', onEnter);
      if (raf.current) {
        cancelAnimationFrame(raf.current);
        raf.current = 0;
      }
    };
  }, [enabled]);

  if (!enabled || !glass.ready) return null;

  return (
    <>
      <LiquidGlassFilter {...glass} />
      <div
        ref={ref}
        aria-hidden="true"
        className="cursor-glass"
        style={{ ...glass.style, width: SIZE, height: SIZE, opacity: active && !suppressed ? 1 : 0 }}
      />
    </>
  );
}
