# Focus GTD Mobile App Setup

## Overview

This is the React Native mobile app for the Focus GTD workflow application, built with Expo SDK 54, NativeWind for Tailwind CSS styling, and sharing business logic with the desktop app through the `@focus-gtd/core` package.

## Tech Stack

- **Expo SDK 54** - React Native framework
- **Expo Router** - File-based navigation
- **NativeWind v4** - Tailwind CSS for React Native
- **React Native 0.81.5** - Mobile framework
- **@focus-gtd/core** - Shared Zustand store
- **AsyncStorage** - Local data persistence
- **TypeScript** - Type safety

## Prerequisites

- **Bun** - Package manager
- **Node.js** - Required by React Native
- **Expo Go** app (for quick testing) OR
- **Android Studio** (for Android emulator) OR
- **Xcode** (for iOS Simulator on macOS)

## Installation

From the project root:

```bash
bun install
```

## Running the App

### Development Server

```bash
# From project root
bun mobile:start

# Or directly in mobile directory
cd apps/mobile
bun start
```

### Running on Android

```bash
# Set up Android environment
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools

# Start emulator (optional)
emulator -avd Pixel_API_34 &

# Run on Android
cd apps/mobile
bun android
```

### Running on iOS (macOS only)

```bash
cd apps/mobile
bun ios
```

### Expo Go (Quick Testing)

1. Install Expo Go from [App Store](https://apps.apple.com/app/expo-go/id982107779) or [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)
2. Run `bun mobile:start`
3. Scan QR code with Camera (iOS) or Expo Go app (Android)

## Project Structure

```
apps/mobile/
├── app/                    # Expo Router pages
│   ├── (tabs)/            # Tab navigation
│   ├── _layout.tsx        # Root layout
│   └── settings.tsx       # Settings page
├── components/            # React components
├── contexts/              # React contexts (theme, language)
├── lib/                   # Utilities
│   ├── storage-adapter.ts # AsyncStorage integration
│   └── storage-file.ts    # File operations for sync
├── global.css             # NativeWind entry CSS
├── tailwind.config.js     # Tailwind configuration
├── metro.config.js        # Metro bundler config
├── babel.config.js        # Babel config with NativeWind
└── nativewind-env.d.ts    # TypeScript declarations
```

## NativeWind (Tailwind CSS)

The mobile app uses NativeWind v4 for Tailwind CSS styling, allowing shared styling patterns with the desktop app.

### Usage

```tsx
import { View, Text } from 'react-native';

function MyComponent() {
  return (
    <View className="bg-blue-500 p-4 rounded-lg">
      <Text className="text-white font-bold">Hello!</Text>
    </View>
  );
}
```

### Configuration Files

| File | Purpose |
|------|---------|
| `tailwind.config.js` | Tailwind theme and NativeWind preset |
| `global.css` | Tailwind directives entry point |
| `babel.config.js` | NativeWind babel preset |
| `metro.config.js` | CSS processing with `withNativeWind` |
| `nativewind-env.d.ts` | TypeScript types for `className` prop |

## Features

- ✅ **Inbox** - Capture new tasks
- ✅ **Next Actions** - Tasks ready to work on
- ✅ **Projects** - Organize multi-step outcomes
- ✅ **Contexts** - Filter by @home, @work, etc.
- ✅ **Board View** - Kanban style with Todo/Next/In-Progress/Done columns
- ✅ **Swipe Actions** - Quick task management (Left: Next/Archive, Right: Delete)
- ✅ **Settings** - Theme, language, sync
- ✅ **File Sync** - Sync data with Dropbox/Syncthing
- ✅ **Dark Mode** - Full dark theme support
- ✅ **i18n** - English and Chinese

## Data & Sync

### Local Storage
Data is stored in AsyncStorage and automatically synced with the shared Zustand store.

### File Sync
Configure a sync folder in Settings to sync via:
- Dropbox
- Syncthing
- Any folder-based sync service

## Troubleshooting

### Metro Cache Issues

```bash
# Clear cache and restart
bun start --clear

# Or manually clear
rm -rf .expo node_modules/.cache
```

### NativeWind Not Working

1. Ensure `global.css` is imported in `app/_layout.tsx`
2. Check `babel.config.js` has NativeWind preset
3. Restart Metro with cache clear

### Build Errors

```bash
# Reinstall dependencies
cd /path/to/Focus-GTD
rm -rf node_modules apps/mobile/node_modules
bun install
```

## Resources

- [Expo Documentation](https://docs.expo.dev/)
- [NativeWind Documentation](https://www.nativewind.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [React Native](https://reactnative.dev/)
