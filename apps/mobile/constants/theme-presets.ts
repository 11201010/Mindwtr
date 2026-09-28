import type { ThemeStatusPreset } from '@mindwtr/core';
import { THEME_PRESETS } from '@mindwtr/core/theme-presets';

// One preset per theme with a bespoke color identity (core's list), plus
// 'default' for the themes that just use plain light/dark colors. The colors
// live in core (theme-presets.ts), where the widget payload reads them too.
export type ThemePresetName = 'default' | ThemeStatusPreset;
export type { ThemePresetColor, ThemePresetColors } from '@mindwtr/core/theme-presets';
export { THEME_PRESETS };
