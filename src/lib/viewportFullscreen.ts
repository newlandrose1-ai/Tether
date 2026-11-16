export interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
}

export interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function getFullscreenElement(doc?: Document | null): Element | null {
  const targetDoc = (doc ?? (typeof document !== 'undefined' ? document : null)) as
    | FullscreenDocument
    | null;
  if (!targetDoc) return null;
  return targetDoc.fullscreenElement ?? targetDoc.webkitFullscreenElement ?? null;
}

export function isBrowserFullscreen(doc?: Document | null): boolean {
  return Boolean(getFullscreenElement(doc));
}

export function canUseBrowserFullscreen(doc?: Document | null): boolean {
  const targetDoc = (doc ?? (typeof document !== 'undefined' ? document : null)) as
    | FullscreenDocument
    | null;
  if (!targetDoc) return false;
  const el = targetDoc.documentElement as FullscreenElement | null;
  if (!el) return false;
  const hasRequest =
    typeof el.requestFullscreen === 'function' ||
    typeof el.webkitRequestFullscreen === 'function';
  if (!hasRequest) return false;
  if (typeof targetDoc.fullscreenEnabled === 'boolean') {
    return targetDoc.fullscreenEnabled;
  }
  if (typeof targetDoc.webkitFullscreenEnabled === 'boolean') {
    return targetDoc.webkitFullscreenEnabled;
  }
  return true;
}

export async function enterBrowserFullscreen(
  doc?: Document | null
): Promise<{ entered: boolean; fallbackReason?: string }> {
  const targetDoc = (doc ?? (typeof document !== 'undefined' ? document : null)) as
    | FullscreenDocument
    | null;
  if (!targetDoc || !targetDoc.documentElement) {
    return { entered: false, fallbackReason: 'Document unavailable for fullscreen.' };
  }

  if (getFullscreenElement(targetDoc)) {
    return { entered: true };
  }

  const rootEl = targetDoc.documentElement as FullscreenElement;

  if (!canUseBrowserFullscreen(targetDoc)) {
    return {
      entered: false,
      fallbackReason: 'Host frame restricts native fullscreen — expanded workspace view applied.',
    };
  }

  try {
    if (typeof rootEl.requestFullscreen === 'function') {
      await rootEl.requestFullscreen();
      return { entered: true };
    }
    if (typeof rootEl.webkitRequestFullscreen === 'function') {
      await rootEl.webkitRequestFullscreen();
      return { entered: true };
    }
  } catch {
    return {
      entered: false,
      fallbackReason: 'Host frame blocked native fullscreen — expanded workspace view applied.',
    };
  }

  return {
    entered: false,
    fallbackReason: 'Native fullscreen unavailable — expanded workspace view applied.',
  };
}

export async function exitBrowserFullscreen(doc?: Document | null): Promise<boolean> {
  const targetDoc = (doc ?? (typeof document !== 'undefined' ? document : null)) as
    | FullscreenDocument
    | null;
  if (!targetDoc) return false;
  if (!getFullscreenElement(targetDoc)) return false;

  try {
    if (typeof targetDoc.exitFullscreen === 'function') {
      await targetDoc.exitFullscreen();
      return true;
    }
    if (typeof targetDoc.webkitExitFullscreen === 'function') {
      await targetDoc.webkitExitFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
