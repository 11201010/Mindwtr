import { WHISPER_MODELS as CORE_WHISPER_MODELS, WHISPER_MODEL_BASE_URL, type WhisperModelDescriptor } from '@mindwtr/core/whisper-models';

export type SettingsScreen =
    | 'main'
    | 'general'
    | 'notifications'
    | 'ai'
    | 'calendar'
    | 'advanced'
    | 'gtd'
    | 'gtd-archive'
    | 'gtd-capture'
    | 'gtd-inbox'
    | 'gtd-pomodoro'
    | 'gtd-review'
    | 'gtd-time-estimates'
    | 'gtd-task-editor'
    | 'manage'
    | 'sync'
    | 'data'
    | 'about';

export const SETTINGS_SCREEN_SET: Record<SettingsScreen, true> = {
    main: true,
    general: true,
    notifications: true,
    ai: true,
    calendar: true,
    advanced: true,
    gtd: true,
    'gtd-archive': true,
    'gtd-capture': true,
    'gtd-inbox': true,
    'gtd-pomodoro': true,
    'gtd-review': true,
    'gtd-time-estimates': true,
    'gtd-task-editor': true,
    manage: true,
    sync: true,
    data: true,
    about: true,
};

export function normalizeSettingsScreen(value: string | undefined): SettingsScreen {
    if (!value || !SETTINGS_SCREEN_SET[value as SettingsScreen]) return 'main';
    // Compatibility alias for links and restored navigation state created
    // before the time-estimate preset-list editor was retired.
    return value === 'gtd-time-estimates' ? 'gtd' : value as SettingsScreen;
}

// The root menu's rows, keywords and search live in core (settings-menu-model.ts),
// shared with the native host.
export {
    buildSettingsMenuSearchText,
    findSettingsMenuMatch,
    SETTINGS_MENU_KEYWORD_KEYS,
    settingsMenuMatchesQuery,
    type SettingsMenuMatch,
    type SettingsMenuRowId,
} from '@mindwtr/core';

// 'en' plus every locale in core's LOCALES table (general-settings-model.ts).
export { SETTINGS_LANGUAGE_OPTIONS as LANGUAGES } from '@mindwtr/core';

export { WHISPER_MODEL_BASE_URL };

// Mobile only offers the small models people can realistically download over
// a phone connection — the full catalogue (including whisper-large-v3-turbo,
// desktop-only) lives in core as the single source of truth for hashes and
// sizes. This subset is a product decision, not a data copy: the numbers
// themselves always come from @mindwtr/core/whisper-models.
const MOBILE_WHISPER_MODEL_IDS = new Set(['whisper-tiny', 'whisper-tiny.en', 'whisper-base', 'whisper-base.en']);
export const WHISPER_MODELS: WhisperModelDescriptor[] = CORE_WHISPER_MODELS
    .filter((model) => MOBILE_WHISPER_MODEL_IDS.has(model.id));
export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0]?.id ?? 'whisper-tiny';

export const UPDATE_BADGE_AVAILABLE_KEY = 'mindwtr-update-available';
export const UPDATE_BADGE_LAST_CHECK_KEY = 'mindwtr-update-last-check';
export const UPDATE_BADGE_LATEST_KEY = 'mindwtr-update-latest';
export const UPDATE_BADGE_INTERVAL_MS = 1000 * 60 * 60 * 24;
export const AI_PROVIDER_CONSENT_KEY = 'mindwtr-ai-provider-consent-v1';

export const FOSS_LOCAL_LLM_MODEL_OPTIONS = ['llama3.2', 'qwen2.5', 'mistral', 'phi-4-mini'];
export const FOSS_LOCAL_LLM_COPILOT_OPTIONS = ['llama3.2', 'qwen2.5', 'mistral', 'phi-4-mini'];

export type MobileExtraConfig = {
    analyticsHeartbeatUrl?: string;
    analyticsHeartbeatChannel?: string;
    analyticsReleaseVersion?: string;
    feedbackEndpointUrl?: string;
    isFossBuild?: boolean | string;
    dropboxAppKey?: string;
    promptTestControlsEnabled?: boolean | string;
    appleClarificationPrototypeEnabled?: boolean | string;
};

export type CloudProvider = 'selfhosted' | 'dropbox' | 'cloudkit';

export const isValidHttpUrl = (value: string): boolean => {
    if (!value.trim()) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};
