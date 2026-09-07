import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useToast } from '@/contexts/toast-context';
import {
    getCaptureIntentConfig,
    isSupported,
    setCaptureIntentEnabled,
    type CaptureIntentConfig,
} from '@/modules/android-widget';

import { SettingToggleRow } from './setting-row';
import { useSettingsLocalization } from './settings.hooks';
import { styles as settingsStyles } from './settings.styles';

function normalizeConfig(value: CaptureIntentConfig): CaptureIntentConfig {
    if (value?.enabled === true && typeof value.token === 'string' && /^[0-9a-f]{64}$/.test(value.token)) {
        return { enabled: true, token: value.token };
    }
    if (value?.enabled === false) return { enabled: false, token: null };
    throw new Error('Invalid capture intent config');
}

export function AndroidCaptureIntentSection() {
    const tc = useThemeColors();
    const { showToast } = useToast();
    const { tr } = useSettingsLocalization();
    const supported = isSupported();
    const [config, setConfig] = useState<CaptureIntentConfig | null>(null);
    const [updating, setUpdating] = useState(false);

    const label = tr('settings.automationCapture');
    const description = tr('settings.automationCaptureDesc');
    const tokenLabel = tr('settings.automationCaptureToken');
    const copyLabel = tr('settings.automationCaptureCopyToken');
    const copiedMessage = tr('settings.automationCaptureCopied');
    const copyFailedMessage = tr('settings.automationCaptureCopyFailed');
    const loadFailedMessage = tr('settings.automationCaptureLoadFailed');
    const updateFailedMessage = tr('settings.automationCaptureUpdateFailed');

    useEffect(() => {
        if (!supported) return;
        let active = true;
        void getCaptureIntentConfig()
            .then((value) => {
                if (active) setConfig(normalizeConfig(value));
            })
            .catch(() => {
                if (!active) return;
                showToast({ message: loadFailedMessage, tone: 'error' });
            });
        return () => {
            active = false;
        };
    }, [loadFailedMessage, showToast, supported]);

    if (!supported) return null;

    const updateEnabled = async (enabled: boolean) => {
        if (!config || updating) return;
        setUpdating(true);
        try {
            const next = normalizeConfig(await setCaptureIntentEnabled(enabled));
            setConfig(next);
        } catch {
            showToast({ message: updateFailedMessage, tone: 'error' });
        } finally {
            setUpdating(false);
        }
    };

    const copyToken = async () => {
        if (!config?.enabled || !config.token) return;
        try {
            await Clipboard.setStringAsync(config.token);
            showToast({ message: copiedMessage, tone: 'info' });
        } catch {
            showToast({ message: copyFailedMessage, tone: 'error' });
        }
    };

    return (
        <View
            testID="android-capture-intent-section"
            style={[settingsStyles.settingCard, localStyles.card, { backgroundColor: tc.cardBg }]}
        >
            <SettingToggleRow
                label={label}
                description={description}
                value={config?.enabled === true}
                disabled={!config || updating}
                onChange={(enabled) => { void updateEnabled(enabled); }}
                switchTestID="android-capture-intent-switch"
            />
            {config?.enabled && config.token ? (
                <View style={[localStyles.tokenRow, { borderTopColor: tc.border }]}>
                    <Text style={[localStyles.tokenLabel, { color: tc.text }]}>{tokenLabel}</Text>
                    <Text
                        selectable
                        testID="android-capture-intent-token"
                        style={[localStyles.token, { color: tc.secondaryText, backgroundColor: tc.bg, borderColor: tc.border }]}
                    >
                        {config.token}
                    </Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        testID="android-capture-intent-copy"
                        style={[localStyles.copyButton, { borderColor: tc.tint }]}
                        onPress={() => { void copyToken(); }}
                        activeOpacity={0.75}
                    >
                        <Text style={[localStyles.copyLabel, { color: tc.tint }]}>{copyLabel}</Text>
                    </TouchableOpacity>
                </View>
            ) : null}
        </View>
    );
}

const localStyles = StyleSheet.create({
    card: {
        marginTop: 12,
    },
    tokenRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 8,
    },
    tokenLabel: {
        fontSize: 15,
        fontWeight: '600',
    },
    token: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 19,
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    copyButton: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    copyLabel: {
        fontSize: 14,
        fontWeight: '600',
    },
});
