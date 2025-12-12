import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme as useSystemColorScheme } from 'react-native';

type ThemeMode = 'system' | 'light' | 'dark';
type ColorScheme = 'light' | 'dark';

interface ThemeContextType {
    themeMode: ThemeMode;
    colorScheme: ColorScheme;
    setThemeMode: (mode: ThemeMode) => void;
    isDark: boolean;
}

const THEME_STORAGE_KEY = '@mindwtr_theme';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemColorScheme = useSystemColorScheme() ?? 'light';
    const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
    const [isLoading, setIsLoading] = useState(true);

    // Determine actual color scheme based on mode and system
    const colorScheme: ColorScheme = themeMode === 'system' ? systemColorScheme : themeMode;
    const isDark = colorScheme === 'dark';

    useEffect(() => {
        loadThemePreference();
    }, []);

    const loadThemePreference = async () => {
        try {
            const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
            if (saved) {
                setThemeModeState(saved as ThemeMode);
            }
        } catch (e) {
            console.error('Failed to load theme preference:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const setThemeMode = async (mode: ThemeMode) => {
        try {
            await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
            setThemeModeState(mode);
        } catch (e) {
            console.error('Failed to save theme preference:', e);
        }
    };

    return (
        <ThemeContext.Provider value={{ themeMode, colorScheme, setThemeMode, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
