import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: vi.fn(), setItem: vi.fn() },
}));
describe('mobile onboarding hint persistence', () => {
    beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
    it('retains dismissal in-session even when storage is unavailable', async () => {
        const { dismissMobileHint, isMobileHintDismissed } = await import('./onboarding-hints');
        vi.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('unavailable'));
        vi.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('unavailable'));
        await dismissMobileHint('inbox-project');
        expect(await isMobileHintDismissed('inbox-project')).toBe(true);
        expect(await isMobileHintDismissed('focus')).toBe(false);
    });
    it('does not let a pending read undo an explicit dismissal', async () => {
        const { dismissMobileHint, isMobileHintDismissed } = await import('./onboarding-hints');
        let resolve!: (value: string | null) => void;
        vi.mocked(AsyncStorage.getItem).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
        const reading = isMobileHintDismissed('focus');
        await dismissMobileHint('focus');
        resolve(null);
        expect(await reading).toBe(true);
        expect(AsyncStorage.setItem).toHaveBeenCalledWith('mindwtr:mobile:onboarding-hint:v1:focus', 'dismissed');
    });
});
