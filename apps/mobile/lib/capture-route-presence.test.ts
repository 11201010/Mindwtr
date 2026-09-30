import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markCaptureRouteMounted,
  resetCaptureRoutePresenceForTests,
  runAfterCaptureRouteGone,
  SHEET_DISMISS_SETTLE_MS,
} from './capture-route-presence';

describe('capture route presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCaptureRoutePresenceForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at once when capture was not open', () => {
    const action = vi.fn();
    runAfterCaptureRouteGone(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('waits for the dismissal to settle after capture unmounts', () => {
    const release = markCaptureRouteMounted();
    release();
    const action = vi.fn();
    runAfterCaptureRouteGone(action);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SHEET_DISMISS_SETTLE_MS - 1);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('waits while capture is still mounted, then settles after it unmounts', () => {
    const release = markCaptureRouteMounted();
    const action = vi.fn();
    runAfterCaptureRouteGone(action);
    vi.advanceTimersByTime(300);
    release();
    vi.advanceTimersByTime(SHEET_DISMISS_SETTLE_MS - 1);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('never waits forever if capture stays mounted', () => {
    markCaptureRouteMounted();
    const action = vi.fn();
    runAfterCaptureRouteGone(action);
    vi.advanceTimersByTime(1500);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('cancel stops a pending action (the screen lost focus first)', () => {
    const release = markCaptureRouteMounted();
    release();
    const action = vi.fn();
    const cancel = runAfterCaptureRouteGone(action);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(action).not.toHaveBeenCalled();
  });
});
