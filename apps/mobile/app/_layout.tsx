import '../shim';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Drawer } from 'expo-router/drawer';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider, useTheme } from '../contexts/theme-context';
import { LanguageProvider, useLanguage } from '../contexts/language-context';
import { setStorageAdapter, useTaskStore } from '@focus-gtd/core';
import { mobileStorage } from '../lib/storage-adapter';

// Initialize storage for mobile
try {
  setStorageAdapter(mobileStorage);
  console.log('[Mobile] Storage adapter initialized');
} catch (e) {
  console.error('[Mobile] Failed to initialize storage adapter:', e);
}
console.log('[Mobile] _layout evaluated');

function RootLayoutContent() {
  const { colorScheme, isDark } = useTheme();
  const { t } = useLanguage();

  useEffect(() => {
    console.log('[Mobile] RootLayout mounted');

    // Load data from storage directly without using the hook
    const loadData = async () => {
      try {
        const store = useTaskStore.getState();
        await store.fetchData();
        console.log('[Mobile] Data loaded successfully');
      } catch (e) {
        console.error('[Mobile] Failed to load data:', e);
      } finally {
        // Hide splash screen (safe for web)
        if (typeof SplashScreen?.hideAsync === 'function') {
          SplashScreen.hideAsync().catch(console.warn);
        }
      }
    };

    loadData();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <Drawer
          screenOptions={{
            drawerActiveTintColor: '#3B82F6',
            drawerInactiveTintColor: '#6B7280',
            headerShown: true,
            drawerStyle: {
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
            },
            headerStyle: {
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
            },
            headerTintColor: isDark ? '#F9FAFB' : '#111827',
            drawerLabelStyle: {
              color: isDark ? '#F9FAFB' : '#111827',
            },
          }}
        >
          <Drawer.Screen
            name="(tabs)"
            options={{
              drawerLabel: t('nav.main'),
              title: t('app.name'),
              headerShown: true,
            }}
          />
          <Drawer.Screen
            name="board"
            options={{
              drawerLabel: t('nav.board'),
              title: t('board.title'),
            }}
          />
          <Drawer.Screen
            name="calendar"
            options={{
              drawerLabel: t('nav.calendar'),
              title: t('calendar.title'),
            }}
          />
          <Drawer.Screen
            name="contexts"
            options={{
              drawerLabel: t('nav.contexts'),
              title: t('contexts.title'),
            }}
          />
          <Drawer.Screen
            name="waiting"
            options={{
              drawerLabel: t('nav.waiting'),
              title: t('waiting.title'),
            }}
          />
          <Drawer.Screen
            name="someday"
            options={{
              drawerLabel: t('nav.someday'),
              title: t('someday.title'),
            }}
          />

          <Drawer.Screen
            name="projects-screen"
            options={{
              drawerLabel: t('nav.projects'),
              title: t('projects.title'),
            }}
          />

          <Drawer.Screen
            name="archived"
            options={{
              drawerLabel: t('nav.archived') || 'Archived',
              title: t('archived.title') || 'Archived',
            }}
          />

          <Drawer.Screen
            name="settings"
            options={{
              drawerLabel: t('nav.settings'),
              title: t('settings.title'),
            }}
          />
        </Drawer>
        <StatusBar style="auto" />
      </NavigationThemeProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <RootLayoutContent />
      </LanguageProvider>
    </ThemeProvider>
  );
}
