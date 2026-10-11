import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQuickCaptureKeyboardDiagnostics } from './use-quick-capture-keyboard-diagnostics';
import { Dimensions, Keyboard } from 'react-native';

const mocks = vi.hoisted(() => ({
  enabled: true, platform: 'android', visible: true,
  log: vi.fn(async () => null),
  listeners: new Map<string, Set<(event: unknown) => void>>(),
  measured: [] as ((x: number, y: number, width: number, height: number) => void)[],
  focused: false,
}));
vi.mock('./app-log', () => ({ isLoggingEnabled: () => mocks.enabled, logInfo: mocks.log }));
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform; } },
  Dimensions: { get: (kind: string) => ({ width: 400, height: kind === 'screen' ? 800 : 760 }) },
  Keyboard: {
    metrics: () => ({ screenX: 0, screenY: 480, width: 400, height: 320, privateTask: 'never log' }),
    isVisible: () => mocks.visible,
    addListener: (name: string, listener: (event: unknown) => void) => {
      const set = mocks.listeners.get(name) ?? new Set();
      set.add(listener);
      mocks.listeners.set(name, set);
      return { remove: () => set.delete(listener) };
    },
  },
}));
const inputRef = { current: {
  isFocused: () => mocks.focused,
  measureInWindow: (callback: typeof mocks.measured[number]) => { mocks.measured.push(callback); },
} as any };
function Harness(props: { visible?: boolean; openRequestId?: number; appliedInset?: number; expanded?: boolean; autoRecord?: boolean }) {
  const callbacks = useQuickCaptureKeyboardDiagnostics({
    visible: true, openRequestId: 1, appliedInset: 0, expanded: false, autoRecord: false,
    avoidanceEnabled: true, inputRef, ...props,
  });
  return React.createElement('capture', callbacks);
}
const entries = () => mocks.log.mock.calls.map(([, context]: any[]) => context.extra);
const fire = (name: string, event: unknown = {}) => act(() => {
  for (const listener of mocks.listeners.get(name) ?? []) listener(event);
});
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.log.mockClear();
  mocks.log.mockImplementation(async () => null);
  mocks.listeners.clear();
  mocks.measured.length = 0;
  mocks.platform = 'android';
  mocks.enabled = true;
  mocks.focused = false;
  mocks.visible = true;
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('observes real IME event names, focus phases, committed inset and measured geometry without payload content', () => {
  act(() => { tree = create(<Harness />); });
  const callbacks = tree!.root.findByType('capture' as any).props;
  act(() => { callbacks.onModalShow(); callbacks.onAutoFocusRequest(); callbacks.onInputFocus(); callbacks.onInputBlur(); });
  fire('keyboardDidShow', { endCoordinates: { screenY: 480, screenX: 0, width: 400, height: 320 }, text: 'private task', url: 'secret URL' });
  fire('keyboardDidChangeFrame', { endCoordinates: { screenY: 490, height: 310 } });
  fire('keyboardDidHide');
  act(() => tree!.update(<Harness appliedInset={320} expanded />));
  act(() => { vi.advanceTimersByTime(450); });
  act(() => mocks.measured[0](12, 450, 350, 60));
  expect(entries().map((entry) => entry.phase)).toEqual([
    'open', 'inset-applied', 'modal-shown', 'auto-focus-request', 'input-focus', 'input-blur',
    'ime-show', 'ime-change', 'ime-hide', 'inset-applied', 'settled', 'settled',
  ]);
  expect(entries().find((entry) => entry.phase === 'ime-show')).toMatchObject({ imeEventY: 480, imeEventHeight: 320 });
  expect(entries().at(-1)).toMatchObject({ appliedInset: 320, expanded: true, outcome: 'measured', inputBottom: 510, imeMetricsY: 480 });
  expect(entries().every((entry) => typeof entry.captureRun === 'number' && typeof entry.captureAttempt === 'number')).toBe(true);
  expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private task|secret URL|never log/);
  expect(Object.keys(entries()[0]).some((name) => /key|pass|user/i.test(name))).toBe(false);
  expect(mocks.log.mock.calls.every(([, context]: any[]) => !context.force)).toBe(true);
});

it('keeps a baseline when native measurement never replies, even with no IME events', () => {
  act(() => { tree = create(<Harness />); });
  act(() => { vi.advanceTimersByTime(450); });
  expect(entries().at(-1)).toMatchObject({ phase: 'settled', outcome: 'baseline', imeVisible: true, focusTracked: false });
  expect(entries().some((entry) => entry.outcome === 'measured')).toBe(false);
});

it('removes listeners and rejects stale timers, event callbacks and measurements on close/reopen/unmount', () => {
  act(() => { tree = create(<Harness />); });
  act(() => { vi.advanceTimersByTime(450); });
  const staleMeasurement = mocks.measured[0];
  const staleListener = [...mocks.listeners.get('keyboardDidShow')!][0];
  const firstAttempt = entries()[0].captureAttempt;
  act(() => tree!.update(<Harness visible={false} />));
  expect([...mocks.listeners.values()].every((set) => set.size === 0)).toBe(true);
  act(() => tree!.update(<Harness openRequestId={2} />));
  const count = entries().length;
  act(() => { staleMeasurement(1, 1, 1, 1); staleListener({}); });
  expect(entries()).toHaveLength(count);
  expect(entries().at(-1).captureAttempt).toBeGreaterThan(firstAttempt);
  act(() => tree!.unmount());
  tree = undefined;
  const finalCount = entries().length;
  act(() => { vi.advanceTimersByTime(1000); });
  expect(entries()).toHaveLength(finalCount);
  expect(entries().at(-1).phase).toBe('close');
});

it('rejects superseded measurements and reserves close within forty lines per opening', () => {
  act(() => { tree = create(<Harness />); });
  act(() => { vi.advanceTimersByTime(450); });
  const stale = mocks.measured[0];
  fire('keyboardDidShow');
  const count = entries().length;
  act(() => stale(1, 1, 1, 1));
  expect(entries()).toHaveLength(count);
  for (let i = 0; i < 100; i += 1) fire('keyboardDidChangeFrame');
  act(() => tree!.update(<Harness visible={false} />));
  act(() => { vi.advanceTimersByTime(1000); });
  expect(entries()).toHaveLength(40);
  expect(entries().at(-1).phase).toBe('close');
});

it.each(['disabled', 'ios', 'closed'])('does no diagnostic work when %s', (mode) => {
  mocks.enabled = mode !== 'disabled';
  mocks.platform = mode === 'ios' ? 'ios' : 'android';
  act(() => { tree = create(<Harness visible={mode !== 'closed'} />); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.measured).toHaveLength(0);
  expect(mocks.listeners.size).toBe(0);
});

it('respects logging being turned off while an opening is active', () => {
  act(() => { tree = create(<Harness />); });
  const count = entries().length;
  mocks.enabled = false;
  fire('keyboardDidShow');
  act(() => { vi.advanceTimersByTime(1000); });
  expect(entries()).toHaveLength(count);
  expect(mocks.measured).toHaveLength(0);
});

it.each(['dimensions', 'metrics', 'visibility', 'focus', 'measurement', 'logging', 'subscription'])('never prevents focus or cleanup when %s throws', (method) => {
  const failure = () => { throw new Error('private native failure'); };
  if (method === 'dimensions') vi.spyOn(Dimensions, 'get').mockImplementation(failure);
  if (method === 'metrics') vi.spyOn(Keyboard, 'metrics').mockImplementation(failure);
  if (method === 'visibility') vi.spyOn(Keyboard, 'isVisible').mockImplementation(failure);
  if (method === 'focus') vi.spyOn(inputRef.current, 'isFocused').mockImplementation(failure);
  if (method === 'measurement') vi.spyOn(inputRef.current, 'measureInWindow').mockImplementation(failure);
  if (method === 'logging') mocks.log.mockImplementation(failure);
  if (method === 'subscription') vi.spyOn(Keyboard, 'addListener').mockImplementation(failure);
  expect(() => act(() => { tree = create(<Harness />); })).not.toThrow();
  const focus = vi.fn();
  expect(() => act(() => {
    tree!.root.findByType('capture' as any).props.onAutoFocusRequest();
    focus();
    vi.advanceTimersByTime(450);
  })).not.toThrow();
  expect(focus).toHaveBeenCalledOnce();
  expect(() => act(() => tree!.update(<Harness visible={false} />))).not.toThrow();
  expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private native failure');
});
