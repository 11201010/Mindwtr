import React from 'react';
import renderer from 'react-test-renderer';
import { Dimensions, Keyboard } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewChecklistKeyboard } from './use-preview-checklist-keyboard';

describe('preview checklist keyboard visibility', () => {
  let tree: renderer.ReactTestRenderer;
  let api: ReturnType<typeof usePreviewChecklistKeyboard>;
  let listeners: Map<string, (event?: any) => void>;
  let offset: number;
  let inputTop: number;
  let viewportHeight: number;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    offset = 0;
    inputTop = 690;
    viewportHeight = 650;
    listeners = new Map();
    vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
    vi.spyOn(Keyboard, 'addListener').mockImplementation((name: any, handler: any) => {
      listeners.set(name, handler);
      return { remove: () => { listeners.delete(name); } } as ReturnType<typeof Keyboard.addListener>;
    });
    scrollTo = vi.fn(({ y }) => { offset = y; });
    const scrollRef = { current: {
      getNativeScrollRef: () => ({
        measureInWindow: (callback: any) => callback(0, 100, 400, viewportHeight),
      }),
      scrollTo,
    } } as any;
    const inputRef = { current: {
      measureInWindow: (callback: any) => callback(0, inputTop - offset, 400, 40),
    } } as any;
    function Harness() {
      api = usePreviewChecklistKeyboard(scrollRef, inputRef);
      return null;
    }
    renderer.act(() => { tree = renderer.create(<Harness />); });
  });

  afterEach(() => {
    renderer.act(() => tree.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const settle = () => {
    renderer.act(() => { vi.runOnlyPendingTimers(); });
    renderer.act(() => { vi.runOnlyPendingTimers(); });
  };

  it('waits for keyboard geometry, adds only the occluded space, and reveals the input', () => {
    renderer.act(() => api.onFocus());
    settle();
    expect(scrollTo).not.toHaveBeenCalled();
    renderer.act(() => listeners.get('keyboardDidShow')?.({ endCoordinates: { screenY: 500, height: 300 } }));
    settle();
    expect(api.bottomInset).toBe(250);
    expect(inputTop - offset + 40).toBeLessThan(500);
    const settledOffset = offset;
    renderer.act(() => api.onLayout());
    settle();
    expect(offset).toBe(settledOffset);
  });

  it('handles a resized Android viewport without adding a second keyboard-sized inset', () => {
    viewportHeight = 400;
    renderer.act(() => {
      api.onFocus();
      listeners.get('keyboardDidShow')?.({ endCoordinates: { screenY: 500, height: 300 } });
    });
    settle();
    expect(api.bottomInset).toBe(0);
    expect(inputTop - offset + 40).toBeLessThan(500);
  });

  it('keeps the composer visible when submitting adds another checklist row', () => {
    renderer.act(() => {
      api.onFocus();
      listeners.get('keyboardDidShow')?.({ endCoordinates: { screenY: 500, height: 300 } });
    });
    settle();
    inputTop += 70;
    renderer.act(() => api.onLayout());
    settle();
    expect(inputTop - offset + 40).toBeLessThan(500);
  });

  it('does not move an unfocused preview or replay pending work after blur', () => {
    renderer.act(() => listeners.get('keyboardDidShow')?.({ endCoordinates: { screenY: 500, height: 300 } }));
    settle();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(api.bottomInset).toBe(0);
    renderer.act(() => {
      api.onFocus();
      api.onBlur();
    });
    settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('clears the added space when the keyboard closes', () => {
    renderer.act(() => {
      api.onFocus();
      listeners.get('keyboardDidShow')?.({ endCoordinates: { screenY: 500, height: 300 } });
    });
    settle();
    renderer.act(() => listeners.get('keyboardDidHide')?.());
    expect(api.bottomInset).toBe(0);
  });
});
