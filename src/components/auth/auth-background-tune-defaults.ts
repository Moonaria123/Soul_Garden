/**
 * 登录/注册全屏背景的可调参数（与 `AuthPageBackground`、左下角「背景调节」面板共用）。
 *
 * **固化流程**：在 `/login` 或 `/register` 用滑块调参 → 点「复制 TS 常量」→ 用剪贴板内容
 * **整段替换**本文件中的 `AUTH_BACKGROUND_TUNE` 对象（保留本文件顶部的 `export type AuthBackgroundTune`）。
 * 调参面板默认关闭；需调试时设 `NEXT_PUBLIC_SHOW_AUTH_BG_TUNER=1`；开启时调节写入 `sessionStorage`。
 */
export type AuthBackgroundTune = {
  /** 窄屏（小于 Tailwind `sm`）下的高斯模糊 px */
  blurPx: number;
  /** sm 及以上视口的模糊 px */
  blurSmPx: number;
  /** 模糊后缩放，略大于 1 以裁掉边缘 */
  scale: number;
  /** 角标 `clamp()` 下限 rem */
  captionClampMinRem: number;
  /** 角标 `clamp()` 中间 vw */
  captionClampVw: number;
  /** 角标 `clamp()` 上限 rem */
  captionClampMaxRem: number;
  /** 角标距底（与 safe-area 取 max） */
  captionBottomRem: number;
  /** 角标距右（与 safe-area 取 max） */
  captionRightRem: number;
};

/** 产品锁定参数（手工调参后固化） */
export const AUTH_BACKGROUND_TUNE: AuthBackgroundTune = {
  blurPx: 32,
  blurSmPx: 8,
  scale: 1.0,
  captionClampMinRem: 1.85,
  captionClampVw: 5.2,
  captionClampMaxRem: 4.55,
  captionBottomRem: 3.6,
  captionRightRem: 6.4,
};
