import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
    getDocsGuideUrl,
    type AppData,
    type Language,
} from '@mindwtr/core';
import {
    createSyncEncryptionCard,
    getSyncEncryptionCardMessages,
    type SyncEncryptionPassphraseField,
} from '@mindwtr/core/sync-encryption-card';

import type { ThemeColors } from '@/hooks/use-theme-colors';
import { logSettingsError } from '@/lib/settings-utils';
import { mobileSyncCryptoPrimitives } from '@/lib/sync-crypto-native';
import {
    changeSyncEncryptionPassphrase,
    declineSyncEncryptionPassphrase,
    disableSyncEncryption,
    enableSyncEncryption,
    getSyncEncryptionStatus,
    isSyncEncryptionBackendPending,
    isSyncEncryptionCleanupDeferredError,
    provideSyncEncryptionPassphrase,
} from '@/lib/sync-encryption-service';

import { SettingsGuideLink } from './settings.shell';
import { styles } from './settings.styles';

type Translate = (key: string) => string;

export type SyncEncryptionCardProps = {
    /** Supplies the attachment worklist; phase 2 leaves attachments plaintext without it. */
    appData: AppData;
    t: Translate;
    tc: ThemeColors;
    language?: Language;
    /** True while a sync/test/save transport action runs. On its falling edge the card
     *  re-reads the encryption state: activating a folder that already holds ciphertext
     *  persists 'remote-encrypted-no-key' during the probe, and the card must flip from
     *  "set a new passphrase" to "enter the existing passphrase" without the user first
     *  failing an enable (#1001). */
    transportBusy?: boolean;
};

// The card's rules live in core (sync-encryption-card.ts) so the native app runs them too;
// this component binds them to the sync encryption service and draws the card.
export function SyncEncryptionCard({ appData, t, tc, language, transportBusy = false }: SyncEncryptionCardProps) {
    const appDataRef = useRef(appData);
    appDataRef.current = appData;
    // One controller per card, created on first use.
    const [card] = useState(() => createSyncEncryptionCard({
        getStatus: () => getSyncEncryptionStatus(),
        isBackendPending: () => isSyncEncryptionBackendPending(),
        enable: (passphrase, options) => enableSyncEncryption(passphrase, options),
        change: (current, next, options) => changeSyncEncryptionPassphrase(current, next, options),
        disable: (options) => disableSyncEncryption(options),
        provide: (passphrase) => provideSyncEncryptionPassphrase(passphrase),
        decline: () => declineSyncEncryptionPassphrase(),
        isCleanupDeferredError: (error): error is Error & { cleanupKind?: string; outcome?: unknown } => isSyncEncryptionCleanupDeferredError(error),
        randomBytes: (length) => mobileSyncCryptoPrimitives.randomBytes(length),
        appData: () => appDataRef.current,
        logSettingsError: (error) => logSettingsError(error),
    }));
    const cardState = useSyncExternalStore(card.subscribe, card.getState);
    const {
        state,
        stateUnavailable,
        flow,
        busy,
        currentPassphrase,
        nextPassphrase,
        confirmPassphrase,
        revealed,
        generated,
        pendingFirstSync,
    } = cardState;

    useEffect(() => card.refresh(), [card]);

    // Falling-edge refresh: see the transportBusy prop comment.
    const previousTransportBusy = React.useRef(transportBusy);
    useEffect(() => {
        const wasBusy = previousTransportBusy.current;
        previousTransportBusy.current = transportBusy;
        if (!wasBusy || transportBusy) return;
        return card.refresh();
    }, [transportBusy, card]);

    const closeFlow = card.closeFlow;
    const openFlow = card.openFlow;
    const generate = card.generate;
    const submitEnable = () => {
        void card.submitEnable();
    };
    const submitChange = () => {
        void card.submitChange();
    };
    const submitDisable = () => {
        void card.submitDisable();
    };
    const submitUnlock = () => {
        void card.submitUnlock();
    };
    const decline = () => {
        void card.decline();
    };
    const retryState = () => {
        void card.retryState();
    };

    if (state === null) {
        if (!stateUnavailable) return null;
        return (
            <>
                <Text style={[styles.sectionTitle, { color: tc.text, marginTop: 16 }]}>
                    {t('settings.syncEncryption')}
                </Text>
                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <View style={styles.settingRowColumn}>
                        <Text accessibilityRole="alert" style={[styles.settingDescription, { color: tc.danger }]}>
                            {t('settings.syncEncryptionStateUnavailable')}
                        </Text>
                    </View>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ busy, disabled: busy }}
                        disabled={busy}
                        onPress={retryState}
                        style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    >
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingLabel, { color: busy ? tc.secondaryText : tc.tint }]}>
                                {t('settings.syncEncryptionRetry')}
                            </Text>
                        </View>
                        {busy && <ActivityIndicator size="small" color={tc.tint} />}
                    </TouchableOpacity>
                </View>
            </>
        );
    }

    const { errorMessage, progressLabel, warningMessage } = getSyncEncryptionCardMessages(cardState, t);

    const renderPassphraseInput = (label: string, value: string, field: SyncEncryptionPassphraseField) => (
        <View style={[styles.inputGroup, { borderTopWidth: 1, borderTopColor: tc.border }]}>
            <Text style={[styles.settingLabel, { color: tc.text }]}>{label}</Text>
            <TextInput
                accessibilityLabel={label}
                value={value}
                onChangeText={(text) => card.setField(field, text)}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!revealed}
                style={[styles.textInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
            />
        </View>
    );

    const renderAction = (label: string, onPress: () => void, disabled = false) => (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: disabled || busy }}
            disabled={disabled || busy}
            onPress={onPress}
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
        >
            <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: disabled || busy ? tc.secondaryText : tc.tint }]}>
                    {label}
                </Text>
            </View>
            {busy && <ActivityIndicator size="small" color={tc.tint} />}
        </TouchableOpacity>
    );

    // Rendered next to the fields it is about, not at the end of the card. Appended after
    // the action rows it landed below the fold on a phone — a wrong passphrase then looked
    // exactly like no answer at all, which is what the Dropbox device test saw.
    const errorBlock = errorMessage
        ? (
            <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                <Text
                    accessibilityLiveRegion="assertive"
                    accessibilityRole="alert"
                    style={[styles.settingDescription, { color: tc.danger }]}
                >
                    {errorMessage}
                </Text>
            </View>
        )
        : null;

    const renderRevealToggle = () => (
        <TouchableOpacity
            accessibilityRole="switch"
            accessibilityState={{ checked: revealed }}
            onPress={card.toggleRevealed}
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
        >
            <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: tc.tint }]}>
                    {t('settings.syncEncryptionShowPassphrase')}
                </Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <>
            <Text style={[styles.sectionTitle, { color: tc.text, marginTop: 16 }]}>
                {t('settings.syncEncryption')}
            </Text>
            <SettingsGuideLink
                title={t('settings.syncEncryptionGuideTitle')}
                description={t('settings.syncEncryptionGuideDesc')}
                url={getDocsGuideUrl('data-sync/', language, 'sync-encryption')}
                testID="sync-encryption-guide-link"
            />
            <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                {state === 'off' && (
                    <>
                        <View style={styles.settingRowColumn}>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {t('settings.syncEncryptionDesc')}
                            </Text>
                        </View>
                        {flow !== 'enable'
                            ? renderAction(t('settings.syncEncryptionEnable'), () => openFlow('enable'))
                            : (
                                <>
                                    <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                                        <Text style={[styles.settingDescription, { color: tc.warning }]}>
                                            {t('settings.syncEncryptionWarningLost')}
                                        </Text>
                                        <Text style={[styles.settingDescription, { color: tc.warning, marginTop: 8 }]}>
                                            {t('settings.syncEncryptionWarningDevices')}
                                        </Text>
                                        {pendingFirstSync && (
                                            <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                                                {t('settings.syncEncryptionEnableBeforeFirstSyncHint')}
                                            </Text>
                                        )}
                                    </View>
                                    {renderPassphraseInput(t('settings.syncEncryptionPassphrase'), nextPassphrase, 'next')}
                                    {renderPassphraseInput(t('settings.syncEncryptionPassphraseConfirm'), confirmPassphrase, 'confirm')}
                                    {errorBlock}
                                    {renderRevealToggle()}
                                    {renderAction(t('settings.syncEncryptionGenerate'), generate)}
                                    {generated && (
                                        <View style={styles.settingRowColumn}>
                                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                                {t('settings.syncEncryptionGeneratedHint')}
                                            </Text>
                                        </View>
                                    )}
                                    {renderAction(
                                        t('settings.syncEncryptionEnable'),
                                        submitEnable,
                                        !nextPassphrase || !confirmPassphrase,
                                    )}
                                    {renderAction(t('common.cancel'), closeFlow)}
                                </>
                            )}
                    </>
                )}

                {(state === 'enabled' || state === 'remote-plaintext') && (
                    <>
                        <View style={styles.settingRowColumn}>
                            <Text style={[styles.settingLabel, { color: tc.text }]}>
                                {t('settings.syncEncryptionStatusOn')}
                            </Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {state === 'remote-plaintext'
                                    ? t('settings.syncEncryptionRemotePlaintextDesc')
                                    : t('settings.syncEncryptionDesc')}
                            </Text>
                        </View>
                        {flow === 'none' && (
                            <>
                                {/* Changing the passphrase would run against a location that no
                                    longer holds ciphertext — disabling here is the only remedy. */}
                                {state === 'enabled' && renderAction(t('settings.syncEncryptionChange'), () => openFlow('change'))}
                                {renderAction(t('settings.syncEncryptionDisable'), () => openFlow('disable'))}
                            </>
                        )}
                        {flow === 'change' && (
                            <>
                                {renderPassphraseInput(t('settings.syncEncryptionCurrentPassphrase'), currentPassphrase, 'current')}
                                {renderPassphraseInput(t('settings.syncEncryptionNewPassphrase'), nextPassphrase, 'next')}
                                {renderPassphraseInput(t('settings.syncEncryptionPassphraseConfirm'), confirmPassphrase, 'confirm')}
                                {errorBlock}
                                {renderRevealToggle()}
                                {renderAction(t('settings.syncEncryptionGenerate'), generate)}
                                {generated && (
                                    <View style={styles.settingRowColumn}>
                                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                            {t('settings.syncEncryptionGeneratedHint')}
                                        </Text>
                                    </View>
                                )}
                                {renderAction(
                                    t('settings.syncEncryptionChange'),
                                    submitChange,
                                    !currentPassphrase || !nextPassphrase || !confirmPassphrase,
                                )}
                                {renderAction(t('common.cancel'), closeFlow)}
                            </>
                        )}
                        {flow === 'disable' && (
                            <>
                                <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                                    <Text style={[styles.settingDescription, { color: tc.warning }]}>
                                        {t(pendingFirstSync
                                            ? 'settings.syncEncryptionDisableWarningNoBackend'
                                            : 'settings.syncEncryptionDisableWarning')}
                                    </Text>
                                </View>
                                {errorBlock}
                                {renderAction(t('settings.syncEncryptionDisable'), submitDisable)}
                                {renderAction(t('common.cancel'), closeFlow)}
                            </>
                        )}
                    </>
                )}

                {state === 'remote-encrypted-no-key' && (
                    <>
                        <View style={styles.settingRowColumn}>
                            <Text style={[styles.settingLabel, { color: tc.text }]}>
                                {t('settings.syncEncryptionLockedTitle')}
                            </Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {t('settings.syncEncryptionLockedDesc')}
                            </Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                                {t('settings.syncEncryptionPausedDesc')}
                            </Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                                {t('settings.syncEncryptionLockedRecheckHint')}
                            </Text>
                        </View>
                        {flow !== 'unlock'
                            ? renderAction(t('settings.syncEncryptionUnlock'), () => openFlow('unlock'))
                            : (
                                <>
                                    {renderPassphraseInput(t('settings.syncEncryptionPassphrase'), currentPassphrase, 'current')}
                                    {errorBlock}
                                    {renderRevealToggle()}
                                    {renderAction(t('settings.syncEncryptionUnlock'), submitUnlock, !currentPassphrase)}
                                    {renderAction(t('settings.syncEncryptionDecline'), decline)}
                                </>
                            )}
                    </>
                )}

                {progressLabel && (
                    <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                        <Text accessibilityLiveRegion="polite" style={[styles.settingDescription, { color: tc.secondaryText }]}>
                            {progressLabel}
                        </Text>
                    </View>
                )}
                {warningMessage && (
                    <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                        <Text accessibilityLiveRegion="polite" style={[styles.settingDescription, { color: tc.warning }]}>
                            {warningMessage}
                        </Text>
                    </View>
                )}
                {/* Errors raised outside a flow (an incomplete transition found by the
                    status read) have no field to sit next to. */}
                {flow === 'none' && errorBlock}
            </View>
        </>
    );
}
