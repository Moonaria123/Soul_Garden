/**
 * 是否显示登录/注册页左下角的背景调节面板。
 * - 默认：**隐藏**。
 * - 需临时调参：`.env.local` 设 `NEXT_PUBLIC_SHOW_AUTH_BG_TUNER=1`（或 `true` / `yes`）后重新构建。
 */
export function isAuthBackgroundTunePanelEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_SHOW_AUTH_BG_TUNER;
  if (v === undefined || v === '') return false;
  const lower = v.trim().toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}
