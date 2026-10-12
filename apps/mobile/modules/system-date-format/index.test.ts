import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDateFormatter } from '@mindwtr/core/date';
import { getSystemDateFormat } from './index';

const mocks = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    getShortDateFormat: vi.fn(),
    requireOptionalNativeModule: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: mocks.requireOptionalNativeModule }));

describe('system date format bridge', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.platform.OS = 'ios';
        mocks.getShortDateFormat.mockReturnValue('dd.MM.yyyy');
        mocks.requireOptionalNativeModule.mockReturnValue({ getShortDateFormat: mocks.getShortDateFormat });
    });

    it('passes the actual platform pattern into shared System display formatting', () => {
        const systemDateFormat = getSystemDateFormat();
        expect(mocks.requireOptionalNativeModule).toHaveBeenCalledWith('MindwtrSystemDateFormat');
        expect(systemDateFormat).toBe('dd.MM.yyyy');
        expect(createDateFormatter({ systemLocale: 'en-DE', systemDateFormat })('2026-09-22', 'P')).toBe('22.09.2026');
        mocks.getShortDateFormat.mockReturnValue('M/d/yy');
        expect(createDateFormatter({ systemLocale: 'en-DE', systemDateFormat: getSystemDateFormat() })('2026-09-22', 'P')).toBe('9/22/26');
    });

    it('keeps non-iOS platforms on the existing locale path', () => {
        mocks.platform.OS = 'android';
        expect(getSystemDateFormat()).toBeUndefined();
        expect(mocks.requireOptionalNativeModule).not.toHaveBeenCalled();
    });

    it('is nonfatal for older clients and failed native reads', () => {
        mocks.requireOptionalNativeModule.mockReturnValue(null);
        expect(getSystemDateFormat()).toBeUndefined();
        mocks.requireOptionalNativeModule.mockReturnValue({});
        expect(getSystemDateFormat()).toBeUndefined();
        mocks.requireOptionalNativeModule.mockImplementation(() => { throw new Error('not linked'); });
        expect(getSystemDateFormat()).toBeUndefined();
    });

    it.each(['YYYY-MM-dd', 'dd.MM.yyyy HH:mm', 'yy/MM/dd', 'yy.MM.dd', {}, null])('declines unsupported native output: %s', (value) => {
        mocks.getShortDateFormat.mockReturnValue(value);
        expect(getSystemDateFormat()).toBeUndefined();
    });
});
