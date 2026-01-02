import { create } from 'zustand';

interface UiState {
    isFocusMode: boolean;
    setFocusMode: (value: boolean) => void;
    toggleFocusMode: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    isFocusMode: false,
    setFocusMode: (value) => set({ isFocusMode: value }),
    toggleFocusMode: () => set((state) => ({ isFocusMode: !state.isFocusMode })),
}));
