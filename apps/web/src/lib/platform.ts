/** True on macOS / iOS (⌘ is the primary modifier). Lightweight — avoids importing the editor engine. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${nav.userAgent}`);
}
