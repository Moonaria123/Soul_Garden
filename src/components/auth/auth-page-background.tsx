'use client';

import '@fontsource/great-vibes/400.css';
import Image from 'next/image';
import loginBg from '../../../public/login-bg.png';
import { useAuthBackgroundTune } from '@/components/auth/auth-background-tune-context';
import { useMediaQuery } from '@/lib/hooks/use-media-query';

/**
 * Auth pages backdrop（SU-ITER-057～061；可调参数见 `auth-background-tune-defaults.ts`）。
 * 背景图使用 **`import ../../../public/login-bg.png`** 参与构建，产出带 **hash** 的 URL，
 * 部署后浏览器会拉取新资源，避免仅换 `public/` 文件却被 CDN/浏览器长期缓存旧图。
 */
export function AuthPageBackground() {
  const { tune } = useAuthBackgroundTune();
  const isSm = useMediaQuery('(min-width: 640px)');
  const blurPx = isSm ? tune.blurSmPx : tune.blurPx;

  return (
    <div
      className="fixed inset-0 z-0 bg-[hsl(var(--login-bg-fallback))] pointer-events-none"
      aria-hidden
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="relative h-full w-full">
          <Image
            src={loginBg}
            alt=""
            fill
            priority
            quality={82}
            sizes="100vw"
            className="object-cover object-center"
            style={{
              filter: `blur(${blurPx}px)`,
              transform: `scale(${tune.scale})`,
            }}
            decoding="async"
          />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-background/8 via-transparent to-background/12 pointer-events-none" />
      <p
        className="absolute z-[1] max-w-[min(88vw,26rem)] text-right font-normal leading-none tracking-[0.02em] text-[hsl(28_20%_34%)] drop-shadow-[0_1px_2px_hsl(38_45%_98%_/_.88)] dark:text-[hsl(32_25%_82%)] dark:drop-shadow-[0_1px_3px_hsl(28_22%_8%_/_.42)]"
        style={{
          fontFamily: '"Great Vibes", cursive',
          bottom: `max(${tune.captionBottomRem}rem, env(safe-area-inset-bottom, 0px))`,
          right: `max(${tune.captionRightRem}rem, env(safe-area-inset-right, 0px))`,
          fontSize: `clamp(${tune.captionClampMinRem}rem, ${tune.captionClampVw}vw, ${tune.captionClampMaxRem}rem)`,
        }}
      >
        Missing You
      </p>
    </div>
  );
}
