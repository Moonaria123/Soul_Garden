import {
  AUTH_BACKGROUND_TUNE,
  type AuthBackgroundTune,
} from '@/components/auth/auth-background-tune-defaults';

/** 与调节面板 Slider 的 min/max 一致，防止越界或旧缓存导致「滑块与画面不一致」 */
export const TUNE_LIMITS = {
  blurPx: { min: 0, max: 64 },
  blurSmPx: { min: 0, max: 64 },
  scale: { min: 1, max: 1.5 },
  captionClampMinRem: { min: 1, max: 6 },
  captionClampVw: { min: 2, max: 16 },
  captionClampMaxRem: { min: 2, max: 8 },
  captionBottomRem: { min: 0, max: 8 },
  captionRightRem: { min: 0, max: 8 },
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readNum(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const x =
    typeof v === 'number' && !Number.isNaN(v)
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number.parseFloat(v)
        : Number.NaN;
  if (Number.isNaN(x)) return fallback;
  return clamp(x, min, max);
}

/** 合并缓存与代码默认值，并把所有字段裁到合法区间 */
export function sanitizeAuthBackgroundTune(
  partial: Partial<AuthBackgroundTune> | Record<string, unknown>,
): AuthBackgroundTune {
  const d = AUTH_BACKGROUND_TUNE;
  const L = TUNE_LIMITS;
  return {
    blurPx: readNum(partial.blurPx, d.blurPx, L.blurPx.min, L.blurPx.max),
    blurSmPx: readNum(
      partial.blurSmPx,
      d.blurSmPx,
      L.blurSmPx.min,
      L.blurSmPx.max,
    ),
    scale: readNum(partial.scale, d.scale, L.scale.min, L.scale.max),
    captionClampMinRem: readNum(
      partial.captionClampMinRem,
      d.captionClampMinRem,
      L.captionClampMinRem.min,
      L.captionClampMinRem.max,
    ),
    captionClampVw: readNum(
      partial.captionClampVw,
      d.captionClampVw,
      L.captionClampVw.min,
      L.captionClampVw.max,
    ),
    captionClampMaxRem: readNum(
      partial.captionClampMaxRem,
      d.captionClampMaxRem,
      L.captionClampMaxRem.min,
      L.captionClampMaxRem.max,
    ),
    captionBottomRem: readNum(
      partial.captionBottomRem,
      d.captionBottomRem,
      L.captionBottomRem.min,
      L.captionBottomRem.max,
    ),
    captionRightRem: readNum(
      partial.captionRightRem,
      d.captionRightRem,
      L.captionRightRem.min,
      L.captionRightRem.max,
    ),
  };
}
