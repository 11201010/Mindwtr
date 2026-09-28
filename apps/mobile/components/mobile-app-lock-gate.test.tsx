import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const authenticateWithDeviceLockMock = vi.hoisted(() => vi.fn());

vi.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0 },
  getEnrolledLevelAsync: vi.fn(),
  authenticateAsync: vi.fn(),
}));
vi.mock('@/lib/mobile-app-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mobile-app-lock')>()),
  authenticateWithDeviceLock: authenticateWithDeviceLockMock,
}));
vi.mock('@/contexts/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#fff', border: '#ccc', filterBg: '#eee', text: '#000', secondaryText: '#666', tint: '#36f', onTint: '#fff',
  }),
}));
vi.mock('@/hooks/use-filled-button-colors', () => ({ useFilledButtonColors: () => ({ backgroundColor: '#36f' }) }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));
vi.mock('lucide-react-native', () => ({ LockKeyhole: (props: any) => React.createElement('LockKeyhole', props) }));

import { MobileAppLockGate } from './mobile-app-lock-gate';

const textNode = (root: ReactTestInstance, text: string) => root.findAll((node) => (
  String(node.type) === 'Text' && node.props.children === text
))[0];

describe('MobileAppLockGate', () => {
  it('names the lock screen as a header and announces a failed unlock', async () => {
    authenticateWithDeviceLockMock.mockResolvedValue({ success: false, reason: 'failed' });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MobileAppLockGate enabled><></></MobileAppLockGate>);
    });

    expect(textNode(tree.root, 'Mindwtr is locked').props.accessibilityRole).toBe('header');

    const unlock = tree.root.findAll((node) => String(node.type) === 'TouchableOpacity')[0];
    await act(async () => { await unlock.props.onPress(); });

    expect(textNode(tree.root, 'Authentication failed. Try again.').props.accessibilityLiveRegion).toBe('polite');
  });
});
