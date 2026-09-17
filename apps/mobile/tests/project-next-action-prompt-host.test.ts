import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('next-action editor host', () => {
    it('keeps task details inside the app-lock and adaptive-window boundaries', () => {
        const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
        const providerStart = layout.indexOf('<ProjectNextActionPromptProvider>');
        const providerEnd = layout.indexOf('</ProjectNextActionPromptProvider>');
        const lockStart = layout.indexOf('<MobileAppLockGate enabled=');
        const lockEnd = layout.indexOf('</MobileAppLockGate>');
        expect(providerStart).toBeGreaterThan(lockStart);
        expect(providerEnd).toBeLessThan(lockEnd);
        expect(layout).toMatch(/<RootAdaptiveWindowHost>\s*<RootLayoutContentInner\s*\/>\s*<\/RootAdaptiveWindowHost>/);
    });
});
