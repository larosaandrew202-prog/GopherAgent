import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { classNames } from '@/lib/format';

/*
 * Liquid glass for the sidebar, adapted from shuding/liquid-glass
 * (https://github.com/shuding/liquid-glass, MIT).
 *
 * The effect is a `<feDisplacementMap>` SVG filter applied through
 * `backdrop-filter: url(#id) …`: a canvas-generated displacement map encodes a
 * lens/rim vector (R = dx, G = dy) that pulls near-edge pixels toward the
 * centre, so the sidebar's border refracts whatever is painted behind it.
 *
 * Notes:
 *  - `backdrop-filter: url()` only works in Chromium. Callers must keep a
 *    `blur()` frosted fallback for other engines.
 *  - The refraction is only visible when there is a textured/gradient backdrop
 *    behind the panel (a flat colour displaces to itself).
 */

function smoothStep(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Build the displacement map: a lens rim `ringPx` wide along every edge. */
function buildDisplacementMap(
  width: number,
  height: number,
  ringPx: number,
  pullPx: number,
): { href: string; scale: number } | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const data = new Uint8ClampedArray(w * h * 4);
  const dxs = new Float32Array(w * h);
  const dys = new Float32Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  let maxScale = 0;
  let i = 0;

  for (let y = 0; y < h; y++) {
    const cy0 = y + 0.5;
    const distY = Math.min(cy0, h - cy0);
    for (let x = 0; x < w; x++) {
      const cx0 = x + 0.5;
      const distX = Math.min(cx0, w - cx0);
      const edgeDist = Math.min(distX, distY);
      const t = smoothStep(ringPx, 0, edgeDist); // 1 at the edge → 0 at ringPx inward
      const amount = t * pullPx;
      const vx = cx - cx0;
      const vy = cy - cy0;
      const len = Math.hypot(vx, vy) || 1;
      const dx = (vx / len) * amount;
      const dy = (vy / len) * amount;
      dxs[i] = dx;
      dys[i] = dy;
      if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx);
      if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy);
      i++;
    }
  }
  if (maxScale === 0) maxScale = 1;

  i = 0;
  for (let p = 0; p < data.length; p += 4) {
    data[p] = (dxs[i] / maxScale) * 0.5 * 255 + 127.5;
    data[p + 1] = (dys[i] / maxScale) * 0.5 * 255 + 127.5;
    data[p + 2] = 0;
    data[p + 3] = 255;
    i++;
  }
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  // feDisplacementMap: displaced = scale * (channel - 0.5); scale = 2·max maps back to dx.
  return { href: canvas.toDataURL(), scale: maxScale * 2 };
}

export interface LiquidGlass {
  filterId: string;
  width: number;
  height: number;
  href: string | null;
  scale: number;
  ready: boolean;
  /** Inline backdrop-filter value; empty until the map is ready. */
  style: CSSProperties;
}

/** Generate the filter + inline `backdrop-filter` style for a measured element. */
export function useLiquidGlass({
  width,
  height,
  ring = 26,
  pull = 18,
  blur = 6,
  debounce = 0,
}: {
  width: number;
  height: number;
  ring?: number;
  pull?: number;
  blur?: number;
  /** Rebuild delay (ms) for size changes; 0 builds synchronously. */
  debounce?: number;
}): LiquidGlass {
  const filterId = useMemo(() => `liquid-glass-${Math.random().toString(36).slice(2, 10)}`, []);
  const [map, setMap] = useState<{ href: string; scale: number } | null>(null);

  useEffect(() => {
    if (width < 2 || height < 2) {
      setMap(null);
      return;
    }
    const build = () => setMap(buildDisplacementMap(width, height, ring, pull));
    if (debounce <= 0) {
      // Synchronous (a few ms): rAF is throttled in background tabs.
      build();
      return;
    }
    const timer = window.setTimeout(build, debounce);
    return () => window.clearTimeout(timer);
  }, [width, height, ring, pull, debounce]);

  const ready = !!map;
  const style: CSSProperties = ready
    ? { backdropFilter: `url(#${filterId}) blur(${blur}px) saturate(160%) brightness(1.04)` }
    : {};

  return { filterId, width, height, href: map?.href ?? null, scale: map?.scale ?? 0, ready, style };
}

/** Hidden SVG holding the displacement filter. */
export function LiquidGlassFilter({ filterId, width, height, href, scale }: LiquidGlass) {
  if (!href) return null;
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'fixed', pointerEvents: 'none' }}>
      <defs>
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
          x="0"
          y="0"
          width={width}
          height={height}
        >
          <feImage href={href} result="map" width={width} height={height} preserveAspectRatio="none" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            xChannelSelector="R"
            yChannelSelector="G"
            scale={scale}
          />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * A `div` with the liquid-glass backdrop applied to itself. Measures its own
 * size and rebuilds the displacement map on resize (debounced by default so a
 * streaming/growing bubble doesn't rebuild every frame).
 */
export function GlassSurface({
  className = '',
  children,
  ring = 16,
  pull = 8,
  blur = 12,
  debounce = 140,
}: {
  className?: string;
  children: ReactNode;
  ring?: number;
  pull?: number;
  blur?: number;
  debounce?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const glass = useLiquidGlass({ width: size.w, height: size.h, ring, pull, blur, debounce });
  return (
    <>
      <LiquidGlassFilter {...glass} />
      <div
        ref={ref}
        className={classNames('glass-surface', className)}
        style={glass.style}
      >
        {children}
      </div>
    </>
  );
}
