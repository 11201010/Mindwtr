/**
 * Lets a screen under the capture route wait until UIKit has finished taking
 * capture off screen before it presents a sheet.
 *
 * iOS refuses to present a modal while another view controller is still being
 * dismissed. The capture route is a native-stack modal: when it pops, the
 * capture screen unmounts and the screen underneath gets its focus event at
 * once, while UIKit is still animating capture away. A React Native <Modal>
 * opened in that window is refused, but RN marks it presented, so its invisible
 * full-screen host stays over the screen and swallows every touch (Projects
 * list freeze after adding a task to a project). The unmount marks the start of
 * the dismissal, so actions wait SETTLE_MS after it.
 */
/** How long UIKit takes to finish dismissing a sheet (measured on an iPhone 12). */
export const SHEET_DISMISS_SETTLE_MS = 700;
const SETTLE_MS = SHEET_DISMISS_SETTLE_MS;
const FALLBACK_MS = 1500;

let mountedCaptureScreens = 0;
let lastUnmountAt = 0;
let waiters: (() => void)[] = [];

const now = () => Date.now();

function flushWaiters() {
  const pending = waiters;
  waiters = [];
  pending.forEach((run) => run());
}

export function markCaptureRouteMounted(): () => void {
  mountedCaptureScreens += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedCaptureScreens = Math.max(0, mountedCaptureScreens - 1);
    lastUnmountAt = now();
    if (mountedCaptureScreens === 0) flushWaiters();
  };
}

/**
 * Runs `action` once capture is off screen: at once when capture was not open
 * recently, otherwise after the dismissal settles (bounded by a fallback).
 * Returns a cancel function.
 */
export function runAfterCaptureRouteGone(action: () => void): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    action();
  };
  const cancel = () => {
    done = true;
    if (timer) clearTimeout(timer);
    waiters = waiters.filter((waiter) => waiter !== afterUnmount);
  };
  const afterUnmount = () => {
    if (done) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
  };
  if (mountedCaptureScreens > 0) {
    waiters.push(afterUnmount);
    timer = setTimeout(run, FALLBACK_MS);
    return cancel;
  }
  const settleLeft = lastUnmountAt + SETTLE_MS - now();
  if (settleLeft <= 0) {
    run();
    return () => {};
  }
  timer = setTimeout(run, settleLeft);
  return cancel;
}

/** Test-only reset. */
export function resetCaptureRoutePresenceForTests(): void {
  mountedCaptureScreens = 0;
  lastUnmountAt = 0;
  waiters = [];
}
