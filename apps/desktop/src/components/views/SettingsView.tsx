import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor, Globe, Check, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage, Language } from '../../contexts/language-context';

type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'focus-gtd-theme';

const LANGUAGES: { id: Language; label: string; native: string }[] = [
    { id: 'en', label: 'English', native: 'English' },
    { id: 'zh', label: 'Chinese', native: '中文' },
];

export function SettingsView() {
    const [themeMode, setThemeMode] = useState<ThemeMode>('system');
    const { language, setLanguage } = useLanguage();
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        loadPreferences();
    }, []);

    useEffect(() => {
        applyTheme(themeMode);
    }, [themeMode]);

    const loadPreferences = () => {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme) setThemeMode(savedTheme as ThemeMode);
    };

    const saveThemePreference = (mode: ThemeMode) => {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
        setThemeMode(mode);
        showSaved();
    };

    const saveLanguagePreference = (lang: Language) => {
        setLanguage(lang);
        showSaved();
    };

    const showSaved = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const applyTheme = (mode: ThemeMode) => {
        const root = document.documentElement;
        if (mode === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.classList.toggle('dark', isDark);
        } else {
            root.classList.toggle('dark', mode === 'dark');
        }
    };

    // Labels based on language
    const labels = {
        en: {
            title: 'Settings',
            subtitle: 'Customize your Focus GTD experience',
            appearance: 'Appearance',
            language: 'Language',
            about: 'About',
            version: 'Version',
            platform: 'Platform',
            developer: 'Developer',
            website: 'Website',
            github: 'GitHub',
            license: 'License',
            system: 'System',
            light: 'Light',
            dark: 'Dark',
            followSystem: 'Follow system appearance',
            lightTheme: 'Light theme',
            darkTheme: 'Dark theme',
            saved: 'Settings saved',
        },
        zh: {
            title: '设置',
            subtitle: '自定义您的 Focus GTD 体验',
            appearance: '外观',
            language: '语言',
            about: '关于',
            version: '版本',
            platform: '平台',
            developer: '开发者',
            website: '网站',
            github: 'GitHub',
            license: '许可证',
            system: '系统',
            light: '浅色',
            dark: '深色',
            followSystem: '跟随系统外观',
            lightTheme: '浅色主题',
            darkTheme: '深色主题',
            saved: '设置已保存',
        },
    };

    const l = labels[language];

    const themeOptions: { id: ThemeMode; label: string; icon: typeof Sun; description: string }[] = [
        { id: 'system', label: l.system, icon: Monitor, description: l.followSystem },
        { id: 'light', label: l.light, icon: Sun, description: l.lightTheme },
        { id: 'dark', label: l.dark, icon: Moon, description: l.darkTheme },
    ];

    const openLink = (url: string) => {
        window.open(url, '_blank');
    };

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold mb-2">{l.title}</h1>
                <p className="text-muted-foreground">{l.subtitle}</p>
            </div>

            {/* Appearance Section */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold">{l.appearance}</h2>
                <div className="grid grid-cols-3 gap-4">
                    {themeOptions.map((option) => (
                        <button
                            key={option.id}
                            onClick={() => saveThemePreference(option.id)}
                            className={cn(
                                "flex flex-col items-center gap-3 p-6 rounded-lg border-2 transition-all",
                                themeMode === option.id
                                    ? "border-primary bg-primary/10"
                                    : "border-border hover:border-primary/50 hover:bg-accent"
                            )}
                        >
                            <option.icon className={cn(
                                "w-8 h-8",
                                themeMode === option.id ? "text-primary" : "text-muted-foreground"
                            )} />
                            <div className="text-center">
                                <div className={cn(
                                    "font-medium",
                                    themeMode === option.id ? "text-primary" : ""
                                )}>{option.label}</div>
                                <div className="text-xs text-muted-foreground">{option.description}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Language Section */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    {l.language}
                </h2>
                <div className="grid grid-cols-2 gap-4">
                    {LANGUAGES.map((lang) => (
                        <button
                            key={lang.id}
                            onClick={() => saveLanguagePreference(lang.id)}
                            className={cn(
                                "flex items-center justify-between p-4 rounded-lg border-2 transition-all",
                                language === lang.id
                                    ? "border-primary bg-primary/10"
                                    : "border-border hover:border-primary/50 hover:bg-accent"
                            )}
                        >
                            <div className="text-left">
                                <div className={cn(
                                    "font-medium text-lg",
                                    language === lang.id ? "text-primary" : ""
                                )}>{lang.native}</div>
                                <div className="text-sm text-muted-foreground">{lang.label}</div>
                            </div>
                            {language === lang.id && (
                                <Check className="w-5 h-5 text-primary" />
                            )}
                        </button>
                    ))}
                </div>
            </section>

            {/* About Section */}
            <section className="space-y-4">
                <h2 className="text-lg font-semibold">{l.about}</h2>
                <div className="bg-card border border-border rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">{l.version}</span>
                        <span>0.1.0</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">{l.platform}</span>
                        <span>Desktop (Electron)</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">{l.license}</span>
                        <span>MIT</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">{l.developer}</span>
                        <span>dongdongbh</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{l.website}</span>
                        <button
                            onClick={() => openLink('https://dongdongbh.tech')}
                            className="text-primary hover:underline flex items-center gap-1"
                        >
                            dongdongbh.tech
                            <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">GitHub</span>
                        <button
                            onClick={() => openLink('https://github.com/dongdongbh')}
                            className="text-primary hover:underline flex items-center gap-1"
                        >
                            github.com/dongdongbh
                            <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </section>

            {saved && (
                <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                    <Check className="w-4 h-4" />
                    {l.saved}
                </div>
            )}
        </div>
    );
}

