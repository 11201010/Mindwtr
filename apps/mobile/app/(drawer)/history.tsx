import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLanguage } from '../../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import DoneScreen from './done';
import ArchivedScreen from './archived';

export type HistoryTab = 'done' | 'archived';

export default function HistoryScreen() {
    const { t } = useLanguage();
    const tc = useThemeColors();
    const router = useRouter();
    const params = useLocalSearchParams<{ tab?: string }>();
    const requestedTab: HistoryTab = params.tab === 'archived' ? 'archived' : 'done';
    const [tab, setTab] = useState<HistoryTab>(requestedTab);
    useEffect(() => setTab(requestedTab), [requestedTab]);
    const options: { id: HistoryTab; label: string }[] = [
        { id: 'done', label: t('nav.done') },
        { id: 'archived', label: t('nav.archived') },
    ];

    return (
        <View style={[styles.root, { backgroundColor: tc.bg }]}>
            <View
                style={[styles.tabs, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}
                accessibilityRole="tablist"
            >
                {options.map((option) => {
                    const selected = tab === option.id;
                    return (
                        <Pressable
                            key={option.id}
                            onPress={() => {
                                setTab(option.id);
                                router.setParams({ tab: option.id });
                            }}
                            style={[
                                styles.tab,
                                { borderBottomColor: selected ? tc.tint : 'transparent' },
                            ]}
                            accessibilityRole="tab"
                            accessibilityLabel={option.label}
                            accessibilityState={{ selected }}
                        >
                            <Text style={[styles.tabText, { color: selected ? tc.tint : tc.secondaryText }]}>
                                {option.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
            <View style={styles.content}>
                {tab === 'done' ? <DoneScreen /> : <ArchivedScreen />}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    tabs: {
        minHeight: 48,
        flexDirection: 'row',
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 12,
    },
    tab: {
        flex: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: 2,
        paddingHorizontal: 12,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '700',
    },
    content: {
        flex: 1,
    },
});
