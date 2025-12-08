import React from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/theme-context';
import { useLanguage, Language } from '../contexts/language-context';
import { Colors } from '@/constants/theme';

const LANGUAGES: { id: Language; native: string }[] = [
    { id: 'en', native: 'English' },
    { id: 'zh', native: '中文' },
];

export default function SettingsScreen() {
    const { themeMode, setThemeMode, isDark } = useTheme();
    const { language, setLanguage, t } = useLanguage();

    const tc = {
        background: isDark ? Colors.dark.background : Colors.light.background,
        text: isDark ? Colors.dark.text : Colors.light.text,
        border: isDark ? '#374151' : '#e5e5e5',
        cardBg: isDark ? '#1F2937' : '#f9f9f9',
        secondaryText: isDark ? '#9CA3AF' : '#666',
    };

    const toggleDarkMode = () => {
        setThemeMode(isDark ? 'light' : 'dark');
    };

    const toggleSystemMode = (useSystem: boolean) => {
        setThemeMode(useSystem ? 'system' : (isDark ? 'dark' : 'light'));
    };

    const openLink = (url: string) => {
        Linking.openURL(url);
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['bottom']}>
            <ScrollView style={styles.scrollView}>
                {/* Appearance */}
                <Text style={[styles.sectionTitle, { color: tc.text }]}>{t('settings.appearance')}</Text>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <View style={styles.settingRow}>
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.useSystem')}</Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {t('settings.followDevice')}
                            </Text>
                        </View>
                        <Switch
                            value={themeMode === 'system'}
                            onValueChange={toggleSystemMode}
                            trackColor={{ false: '#767577', true: '#3B82F6' }}
                            thumbColor={themeMode === 'system' ? '#fff' : '#f4f3f4'}
                        />
                    </View>

                    {themeMode !== 'system' && (
                        <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                            <View style={styles.settingInfo}>
                                <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.darkMode')}</Text>
                                <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                    {isDark ? t('settings.darkEnabled') : t('settings.lightEnabled')}
                                </Text>
                            </View>
                            <Switch
                                value={isDark}
                                onValueChange={toggleDarkMode}
                                trackColor={{ false: '#767577', true: '#3B82F6' }}
                                thumbColor={isDark ? '#fff' : '#f4f3f4'}
                            />
                        </View>
                    )}
                </View>

                {/* Language */}
                <Text style={[styles.sectionTitle, { color: tc.text, marginTop: 24 }]}>{t('settings.language')}</Text>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <Text style={[styles.settingDescription, { color: tc.secondaryText, padding: 16, paddingBottom: 8 }]}>
                        {t('settings.selectLang')}
                    </Text>
                    {LANGUAGES.map((lang, idx) => (
                        <TouchableOpacity
                            key={lang.id}
                            style={[
                                styles.settingRow,
                                idx > 0 && { borderTopWidth: 1, borderTopColor: tc.border }
                            ]}
                            onPress={() => setLanguage(lang.id)}
                        >
                            <View style={styles.settingInfo}>
                                <Text style={[styles.settingLabel, { color: tc.text }]}>{lang.native}</Text>
                            </View>
                            {language === lang.id && (
                                <Text style={{ color: '#3B82F6', fontSize: 20 }}>✓</Text>
                            )}
                        </TouchableOpacity>
                    ))}
                </View>

                {/* About */}
                <Text style={[styles.sectionTitle, { color: tc.text, marginTop: 24 }]}>{t('settings.about')}</Text>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <View style={styles.settingRow}>
                        <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.version')}</Text>
                        <Text style={[styles.settingValue, { color: tc.secondaryText }]}>0.1.0</Text>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                        <Text style={[styles.settingLabel, { color: tc.text }]}>{language === 'zh' ? '许可证' : 'License'}</Text>
                        <Text style={[styles.settingValue, { color: tc.secondaryText }]}>MIT</Text>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                        <Text style={[styles.settingLabel, { color: tc.text }]}>{language === 'zh' ? '开发者' : 'Developer'}</Text>
                        <Text style={[styles.settingValue, { color: tc.secondaryText }]}>dongdongbh</Text>
                    </View>
                    <TouchableOpacity
                        style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                        onPress={() => openLink('https://dongdongbh.tech')}
                    >
                        <Text style={[styles.settingLabel, { color: tc.text }]}>{language === 'zh' ? '网站' : 'Website'}</Text>
                        <Text style={[styles.linkText]}>dongdongbh.tech</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                        onPress={() => openLink('https://github.com/dongdongbh')}
                    >
                        <Text style={[styles.settingLabel, { color: tc.text }]}>GitHub</Text>
                        <Text style={[styles.linkText]}>github.com/dongdongbh</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
        padding: 16,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        marginBottom: 8,
        marginLeft: 4,
    },
    settingCard: {
        borderRadius: 12,
        overflow: 'hidden',
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    settingInfo: {
        flex: 1,
        marginRight: 16,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
    },
    settingDescription: {
        fontSize: 13,
        marginTop: 2,
    },
    settingValue: {
        fontSize: 16,
    },
    linkText: {
        fontSize: 16,
        color: '#3B82F6',
    },
});

