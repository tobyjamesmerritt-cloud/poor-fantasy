/**
 * A styled yes/no question (instead of the browser's confirm()). It is drawn in
 * the shared popup frame (popupFrame.ts), swapped in over whatever popup is
 * showing, so popups never stack. main.ts binds the frame once at startup.
 */
import type { PopupFrame } from './popupFrame';

let frame: PopupFrame | null = null;

export function bindConfirm(f: PopupFrame): void {
  frame = f;
}

/** Resolves true for OK. */
export function confirmDialog(opts: { title: string; text: string; ok: string; cancel: string; danger?: boolean }): Promise<boolean> {
  if (!frame) throw new Error('confirmDialog used before bindConfirm');
  return frame.confirm(opts);
}
