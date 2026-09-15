import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, type ScrollView, type TextInput } from 'react-native';

/** The preview owns its vertical scroll; the sibling Edit tab must not move it. */
export function usePreviewChecklistKeyboard(
  scrollRef: RefObject<ScrollView | null>,
  inputRef: RefObject<TextInput | null>,
) {
  const [bottomInset, setBottomInset] = useState(0);
  const insetRef = useRef(0);
  const offsetRef = useRef(0);
  const keyboardTopRef = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const generationRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancelPending = useCallback(() => {
    generationRef.current += 1;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const revealInput = useCallback(() => {
    const scroll = scrollRef.current;
    const input = inputRef.current;
    const keyboardTop = keyboardTopRef.current;
    if (!focusedRef.current || keyboardTop == null || !scroll || !input) return;
    const generation = generationRef.current;
    const isCurrent = () => focusedRef.current && generation === generationRef.current;
    scroll.getNativeScrollRef()?.measureInWindow((_x, scrollY, _width, scrollHeight) => {
      if (!isCurrent() || !Number.isFinite(scrollY) || !Number.isFinite(scrollHeight)) return;
      // Use the measured viewport, including when Android already resized the
      // window. Adding the full keyboard height would double-count that resize.
      const inset = Math.max(0, scrollY + scrollHeight - keyboardTop);
      if (insetRef.current !== inset) {
        insetRef.current = inset;
        setBottomInset(inset);
        return; // Re-measure after the new scrollable space commits below.
      }
      const visibleBottom = Math.min(scrollY + scrollHeight, keyboardTop);
      const visibleHeight = Math.max(0, visibleBottom - scrollY);
      if (!visibleHeight) return;
      input.measureInWindow((_ix, inputY, _iw, inputHeight) => {
        if (!isCurrent() || !Number.isFinite(inputY) || !Number.isFinite(inputHeight)) return;
        const clearance = visibleHeight * 0.18;
        const overlap = inputY + inputHeight + clearance - visibleBottom;
        const delta = overlap > 0 ? overlap : Math.min(0, inputY - scrollY);
        if (!delta) return;
        const y = Math.max(0, offsetRef.current + delta);
        offsetRef.current = y;
        scroll.scrollTo({ y, animated: false });
      });
    });
  }, [inputRef, scrollRef]);

  const scheduleReveal = useCallback(() => {
    cancelPending();
    if (!focusedRef.current) return;
    // Re-measure after React commits the inset and after native keyboard/layout
    // animations. Each new layout replaces these bounded retries.
    timersRef.current = [0, 180, 360].map((delay) => setTimeout(revealInput, delay));
  }, [cancelPending, revealInput]);

  const clearInset = useCallback(() => {
    cancelPending();
    insetRef.current = 0;
    setBottomInset(0);
  }, [cancelPending]);

  useEffect(() => {
    const updateFrame = (event: { endCoordinates?: { screenY?: number; height?: number } }) => {
      const coordinates = event.endCoordinates;
      const screenHeight = Dimensions.get('screen').height;
      const top = coordinates?.screenY ?? (screenHeight - (coordinates?.height ?? 0));
      keyboardTopRef.current = Number.isFinite(top) && top < screenHeight ? top : null;
      if (keyboardTopRef.current == null) clearInset();
      else scheduleReveal();
    };
    const hide = () => {
      keyboardTopRef.current = null;
      clearInset();
    };
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', updateFrame),
      Keyboard.addListener('keyboardWillChangeFrame', updateFrame),
      Keyboard.addListener('keyboardDidChangeFrame', updateFrame),
      Keyboard.addListener('keyboardDidHide', hide),
    ];
    return () => {
      focusedRef.current = false;
      cancelPending();
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [cancelPending, clearInset, scheduleReveal]);

  useEffect(scheduleReveal, [bottomInset, scheduleReveal]);

  return {
    bottomInset,
    onFocus: () => {
      focusedRef.current = true;
      scheduleReveal();
    },
    onBlur: () => {
      focusedRef.current = false;
      clearInset();
    },
    onLayout: scheduleReveal,
    onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      offsetRef.current = event.nativeEvent.contentOffset.y;
    },
  };
}
