'use client';

import { useCallback } from 'react';
import { useAuthBackgroundTune } from '@/components/auth/auth-background-tune-context';
import { AUTH_BACKGROUND_TUNE } from '@/components/auth/auth-background-tune-defaults';
import {
  type AuthBackgroundTune,
} from '@/components/auth/auth-background-tune-defaults';
import { TUNE_LIMITS } from '@/components/auth/auth-background-tune-sanitize';
import { isAuthBackgroundTunePanelEnabled } from '@/components/auth/auth-background-tune-visibility';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <Label className="text-xs font-normal">{label}</Label>
        <span className="tabular-nums text-foreground">{value}</span>
      </div>
      {children}
    </div>
  );
}

function formatTuneAsTsObject(t: AuthBackgroundTune): string {
  return `export const AUTH_BACKGROUND_TUNE: AuthBackgroundTune = {
  blurPx: ${t.blurPx},
  blurSmPx: ${t.blurSmPx},
  scale: ${t.scale.toFixed(2)},
  captionClampMinRem: ${t.captionClampMinRem.toFixed(2)},
  captionClampVw: ${t.captionClampVw.toFixed(1)},
  captionClampMaxRem: ${t.captionClampMaxRem.toFixed(2)},
  captionBottomRem: ${t.captionBottomRem.toFixed(2)},
  captionRightRem: ${t.captionRightRem.toFixed(2)},
};
`;
}

/**
 * 登录/注册共用：临时调节背景虚化、角标字号与位置；满意后把「复制 TS 常量」内容写入
 * `auth-background-tune-defaults.ts` 中的 `AUTH_BACKGROUND_TUNE`。
 */
export function AuthBackgroundTunePanel() {
  const { tune, setTune, resetToCodeDefaults } = useAuthBackgroundTune();

  const copyJson = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(tune, null, 2));
  }, [tune]);

  const copyTs = useCallback(() => {
    void navigator.clipboard.writeText(formatTuneAsTsObject(tune));
  }, [tune]);

  if (!isAuthBackgroundTunePanelEnabled()) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-4 z-[100] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-md dark:bg-card/90"
      role="region"
      aria-label="登录背景调节（临时）"
    >
      <div className="mb-2 flex items-start justify-between gap-2 border-b border-border/60 pb-2">
        <p className="text-sm font-medium leading-tight text-foreground">
          背景调节（临时）
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={resetToCodeDefaults}
          >
            重置
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={copyJson}
          >
            复制 JSON
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7 text-xs"
            onClick={copyTs}
          >
            复制 TS 常量
          </Button>
        </div>
      </div>

      <div className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto pr-0.5">
        <Row label="虚化 blur（默认屏）" value={`${tune.blurPx}px`}>
          <Slider
            min={TUNE_LIMITS.blurPx.min}
            max={TUNE_LIMITS.blurPx.max}
            step={1}
            value={[tune.blurPx]}
            onValueChange={([v]) => setTune({ blurPx: v })}
          />
        </Row>
        <Row label="虚化 blur（sm+）" value={`${tune.blurSmPx}px`}>
          <Slider
            min={TUNE_LIMITS.blurSmPx.min}
            max={TUNE_LIMITS.blurSmPx.max}
            step={1}
            value={[tune.blurSmPx]}
            onValueChange={([v]) => setTune({ blurSmPx: v })}
          />
        </Row>
        <Row label="缩放 scale" value={tune.scale.toFixed(2)}>
          <Slider
            min={TUNE_LIMITS.scale.min}
            max={TUNE_LIMITS.scale.max}
            step={0.01}
            value={[tune.scale]}
            onValueChange={([v]) => setTune({ scale: v })}
          />
        </Row>
        <Row
          label="角标 clamp 下限 (rem)"
          value={`${tune.captionClampMinRem.toFixed(2)}`}
        >
          <Slider
            min={TUNE_LIMITS.captionClampMinRem.min}
            max={TUNE_LIMITS.captionClampMinRem.max}
            step={0.05}
            value={[tune.captionClampMinRem]}
            onValueChange={([v]) => setTune({ captionClampMinRem: v })}
          />
        </Row>
        <Row
          label="角标 clamp 中间 (vw)"
          value={`${tune.captionClampVw.toFixed(1)}`}
        >
          <Slider
            min={TUNE_LIMITS.captionClampVw.min}
            max={TUNE_LIMITS.captionClampVw.max}
            step={0.1}
            value={[tune.captionClampVw]}
            onValueChange={([v]) => setTune({ captionClampVw: v })}
          />
        </Row>
        <Row
          label="角标 clamp 上限 (rem)"
          value={`${tune.captionClampMaxRem.toFixed(2)}`}
        >
          <Slider
            min={TUNE_LIMITS.captionClampMaxRem.min}
            max={TUNE_LIMITS.captionClampMaxRem.max}
            step={0.05}
            value={[tune.captionClampMaxRem]}
            onValueChange={([v]) => setTune({ captionClampMaxRem: v })}
          />
        </Row>
        <Row label="角标距底 (rem)" value={`${tune.captionBottomRem.toFixed(2)}`}>
          <Slider
            min={TUNE_LIMITS.captionBottomRem.min}
            max={TUNE_LIMITS.captionBottomRem.max}
            step={0.05}
            value={[tune.captionBottomRem]}
            onValueChange={([v]) => setTune({ captionBottomRem: v })}
          />
        </Row>
        <Row label="角标距右 (rem)" value={`${tune.captionRightRem.toFixed(2)}`}>
          <Slider
            min={TUNE_LIMITS.captionRightRem.min}
            max={TUNE_LIMITS.captionRightRem.max}
            step={0.05}
            value={[tune.captionRightRem]}
            onValueChange={([v]) => setTune({ captionRightRem: v })}
          />
        </Row>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        默认值见{' '}
        <code className="rounded bg-muted px-1">auth-background-tune-defaults.ts</code>
        。调好后点「复制 TS 常量」，替换文件中{' '}
        <code className="rounded bg-muted px-1">AUTH_BACKGROUND_TUNE</code>；当前代码基线：blur{' '}
        {AUTH_BACKGROUND_TUNE.blurPx}/{AUTH_BACKGROUND_TUNE.blurSmPx}px，scale{' '}
        {AUTH_BACKGROUND_TUNE.scale}        。调节会暂存{' '}
        <code className="rounded bg-muted px-1">sessionStorage</code>
        。默认不显示本面板；需调参时在{' '}
        <code className="rounded bg-muted px-1">.env.local</code> 设{' '}
        <code className="rounded bg-muted px-1">NEXT_PUBLIC_SHOW_AUTH_BG_TUNER=1</code>{' '}
        并重新构建。
      </p>
    </div>
  );
}
