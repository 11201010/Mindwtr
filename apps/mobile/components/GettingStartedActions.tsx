import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Inbox, Plus, Star } from 'lucide-react-native';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useLanguage } from '@/contexts/language-context';

export type GettingStartedAction = 'capture' | 'inbox' | 'focus';

export function GettingStartedActions({ onAction }: { onAction: (action: GettingStartedAction) => void }) {
    const tc = useThemeColors();
    const { t } = useLanguage();
    const actions = [
        { id: 'capture', label: 'onboarding.captureAction', Icon: Plus },
        { id: 'inbox', label: 'starter.processInbox.check1', Icon: Inbox },
        { id: 'focus', label: 'starter.focus.check1', Icon: Star },
    ] as const;
    return <View style={styles.root}>
        <Text style={[styles.copy, { color: tc.secondaryText }]}>{t('onboarding.tryWorkflow')}</Text>
        <View style={styles.actions}>
            {actions.map(({ id, label, Icon }) => <Pressable key={id} accessibilityRole="button"
                onPress={() => onAction(id)}
                style={({ pressed }) => [styles.action, { borderColor: tc.border, backgroundColor: pressed ? tc.filterBg : tc.cardBg }]}>
                <Icon size={16} color={tc.text} />
                <Text style={[styles.label, { color: tc.text }]}>{t(label)}</Text>
            </Pressable>)}
        </View>
    </View>;
}

const styles = StyleSheet.create({
    root: { padding: 12, gap: 8 },
    copy: { fontSize: 14, lineHeight: 21 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, maxWidth: '100%' },
    label: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
});
