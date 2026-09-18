import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getEnglishSettingsLabels } from './labels';
import { SettingsAdvancedPage } from './SettingsAdvancedPage';

const baseProps: Parameters<typeof SettingsAdvancedPage>[0] = {
    t: getEnglishSettingsLabels(),
    onOpenHelp: vi.fn(),
    keybindingStyle: 'standard',
    onKeybindingStyleChange: vi.fn(),
    isTauri: true,
    localApiStatus: {
        enabled: false,
        running: false,
        port: 3456,
        url: null,
        error: null,
    },
    localApiPortInput: '3456',
    localApiBusy: false,
    localApiPortError: '',
    networkProxyUrl: '',
    desktopRenderingConfig: {
        disableHardwareAcceleration: false,
    },
    desktopRenderingBusy: false,
    onLocalApiToggle: vi.fn(),
    onLocalApiPortInputChange: vi.fn(),
    onLocalApiPortCommit: vi.fn(),
    onNetworkProxyUrlChange: vi.fn(),
    onSaveNetworkProxy: vi.fn(),
    onDesktopRenderingToggle: vi.fn(),
};

describe('SettingsAdvancedPage', () => {
    it('keeps keyboard and window controls folded and preserves their callbacks', () => {
        const onKeybindingStyleChange = vi.fn();
        const onLaunchAtStartupChange = vi.fn();
        const onOpenHelp = vi.fn();
        const { getByRole, queryByRole } = render(
            <SettingsAdvancedPage
                {...baseProps}
                onOpenHelp={onOpenHelp}
                onKeybindingStyleChange={onKeybindingStyleChange}
                showLaunchAtStartup
                launchAtStartupEnabled={false}
                onLaunchAtStartupChange={onLaunchAtStartupChange}
            />,
        );

        expect(queryByRole('combobox', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument();
        fireEvent.click(getByRole('button', { name: 'Keyboard and window' }));
        fireEvent.change(getByRole('combobox', { name: 'Keyboard Shortcuts' }), {
            target: { value: 'vim' },
        });
        fireEvent.click(getByRole('button', { name: 'Show shortcuts' }));
        fireEvent.click(getByRole('switch', { name: 'Launch at startup' }));

        expect(onKeybindingStyleChange).toHaveBeenCalledWith('vim');
        expect(onOpenHelp).toHaveBeenCalledTimes(1);
        expect(onLaunchAtStartupChange).toHaveBeenCalledWith(true);
    });

    it('toggles the local API server', () => {
        const onLocalApiToggle = vi.fn();
        const { getByRole } = render(
            <SettingsAdvancedPage
                {...baseProps}
                onLocalApiToggle={onLocalApiToggle}
            />,
        );

        fireEvent.click(getByRole('switch', { name: 'Enable local API server' }));

        expect(onLocalApiToggle).toHaveBeenCalledWith(true);
    });

    it('commits the local API port on blur', () => {
        const onLocalApiPortInputChange = vi.fn();
        const onLocalApiPortCommit = vi.fn();
        const { getByRole } = render(
            <SettingsAdvancedPage
                {...baseProps}
                onLocalApiPortInputChange={onLocalApiPortInputChange}
                onLocalApiPortCommit={onLocalApiPortCommit}
            />,
        );

        const input = getByRole('spinbutton', { name: 'Port' });
        fireEvent.change(input, { target: { value: '4567' } });
        fireEvent.blur(input);

        expect(onLocalApiPortInputChange).toHaveBeenCalledWith('4567');
        expect(onLocalApiPortCommit).toHaveBeenCalled();
    });

    it('toggles software rendering fallback', () => {
        const onDesktopRenderingToggle = vi.fn();
        const { getByRole } = render(
            <SettingsAdvancedPage
                {...baseProps}
                onDesktopRenderingToggle={onDesktopRenderingToggle}
            />,
        );

        fireEvent.click(getByRole('switch', { name: 'Use software rendering' }));

        expect(onDesktopRenderingToggle).toHaveBeenCalledWith(true);
    });

    it('keeps proxy settings folded until opened', () => {
        const onNetworkProxyUrlChange = vi.fn();
        const onSaveNetworkProxy = vi.fn();
        const { getByRole, queryByRole } = render(
            <SettingsAdvancedPage
                {...baseProps}
                networkProxyUrl="http://proxy.local:8080"
                onNetworkProxyUrlChange={onNetworkProxyUrlChange}
                onSaveNetworkProxy={onSaveNetworkProxy}
            />,
        );

        expect(queryByRole('textbox', { name: 'Proxy URL' })).not.toBeInTheDocument();

        fireEvent.click(getByRole('button', { name: /Proxy URL/ }));
        fireEvent.change(getByRole('textbox', { name: 'Proxy URL' }), {
            target: { value: 'https://proxy.local:8443' },
        });
        fireEvent.click(getByRole('button', { name: 'Save proxy' }));

        expect(onNetworkProxyUrlChange).toHaveBeenCalledWith('https://proxy.local:8443');
        expect(onSaveNetworkProxy).toHaveBeenCalled();
    });
});
