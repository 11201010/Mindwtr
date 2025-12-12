import { useEffect, useState, type ComponentType } from 'react';
import {
    ArrowLeft,
    Bell,
    Check,
    ChevronRight,
    Database,
    ExternalLink,
    Globe,
    Info,
    Keyboard,
    Monitor,
    Moon,
    RefreshCw,
    Sun,
} from 'lucide-react';
import { useTaskStore, safeFormatDate } from '@mindwtr/core';

import { useKeybindings } from '../../contexts/keybinding-context';
import { useLanguage, type Language } from '../../contexts/language-context';
import { isTauriRuntime } from '../../lib/runtime';
import { SyncService } from '../../lib/sync-service';
import { checkForUpdates, type UpdateInfo, GITHUB_RELEASES_URL } from '../../lib/update-service';
import { cn } from '../../lib/utils';

type ThemeMode = 'system' | 'light' | 'dark';
type SettingsPage = 'main' | 'appearance' | 'language' | 'keybindings' | 'notifications' | 'sync' | 'about';

const THEME_STORAGE_KEY = 'mindwtr-theme';

const LANGUAGES: { id: Language; label: string; native: string }[] = [
    { id: 'en', label: 'English', native: 'English' },
    { id: 'zh', label: 'Chinese', native: '中文' },
];

function deriveConfigPath(dataPath: string): string {
    if (!dataPath) return '';
    const separator = dataPath.includes('\\') ? '\\' : '/';
    const idx = dataPath.lastIndexOf(separator);
    const dir = idx >= 0 ? dataPath.slice(0, idx) : '';
    return dir ? `${dir}${separator}config.toml` : 'config.toml';
}

export function SettingsView() {
    const [page, setPage] = useState<SettingsPage>('main');
    const [themeMode, setThemeMode] = useState<ThemeMode>('system');
    const { language, setLanguage } = useLanguage();
    const { style: keybindingStyle, setStyle: setKeybindingStyle, openHelp } = useKeybindings();
    const { settings, updateSettings } = useTaskStore();

    const [saved, setSaved] = useState(false);
    const [appVersion, setAppVersion] = useState('0.1.0');
    const [dataPath, setDataPath] = useState('');

    const notificationsEnabled = settings?.notificationsEnabled !== false;
    const dailyDigestMorningEnabled = settings?.dailyDigestMorningEnabled === true;
    const dailyDigestEveningEnabled = settings?.dailyDigestEveningEnabled === true;
    const dailyDigestMorningTime = settings?.dailyDigestMorningTime || '09:00';
    const dailyDigestEveningTime = settings?.dailyDigestEveningTime || '20:00';

    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [updateError, setUpdateError] = useState<string | null>(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);

    const [syncPath, setSyncPath] = useState<string>('');
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncBackend, setSyncBackend] = useState<'file' | 'webdav' | 'cloud'>('file');
    const [webdavUrl, setWebdavUrl] = useState('');
    const [webdavUsername, setWebdavUsername] = useState('');
    const [webdavPassword, setWebdavPassword] = useState('');
    const [cloudUrl, setCloudUrl] = useState('');
    const [cloudToken, setCloudToken] = useState('');

    useEffect(() => {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') {
            setThemeMode(savedTheme);
        }

        if (!isTauriRuntime()) {
            setAppVersion('web');
            return;
        }

        import('@tauri-apps/api/app')
            .then(({ getVersion }) => getVersion())
            .then(setAppVersion)
            .catch(console.error);

        import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke<string>('get_data_path_cmd'))
            .then(setDataPath)
            .catch(console.error);
    }, []);

    useEffect(() => {
        SyncService.getSyncPath().then(setSyncPath).catch(console.error);
        SyncService.getSyncBackend().then(setSyncBackend).catch(console.error);
        SyncService.getWebDavConfig()
            .then((cfg) => {
                setWebdavUrl(cfg.url);
                setWebdavUsername(cfg.username);
                setWebdavPassword(cfg.password);
            })
            .catch(console.error);
        SyncService.getCloudConfig()
            .then((cfg) => {
                setCloudUrl(cfg.url);
                setCloudToken(cfg.token);
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        if (themeMode === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.classList.toggle('dark', isDark);
        } else {
            root.classList.toggle('dark', themeMode === 'dark');
        }
    }, [themeMode]);

    const showSaved = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
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

    const openLink = (url: string) => {
        window.open(url, '_blank');
    };

    const handleChangeSyncLocation = async () => {
        try {
            if (!isTauriRuntime()) return;

            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: t.selectSyncFolderTitle,
            });

            if (selected && typeof selected === 'string') {
                setSyncPath(selected);
                const result = await SyncService.setSyncPath(selected);
                if (result.success) {
                    showSaved();
                }
            }
        } catch (error) {
            console.error('Failed to change sync location:', error);
        }
    };

    const handleSetSyncBackend = async (backend: 'file' | 'webdav' | 'cloud') => {
        setSyncBackend(backend);
        await SyncService.setSyncBackend(backend);
        showSaved();
    };

    const handleSaveWebDav = async () => {
        await SyncService.setWebDavConfig({
            url: webdavUrl.trim(),
            username: webdavUsername.trim(),
            password: webdavPassword,
        });
        showSaved();
    };

    const handleSaveCloud = async () => {
        await SyncService.setCloudConfig({
            url: cloudUrl.trim(),
            token: cloudToken.trim(),
        });
        showSaved();
    };

    const handleSync = async () => {
        try {
            setIsSyncing(true);
            setSyncError(null);

            if (syncBackend === 'webdav') {
                if (!webdavUrl.trim()) return;
                await handleSaveWebDav();
            }
            if (syncBackend === 'cloud') {
                if (!cloudUrl.trim() || !cloudToken.trim()) return;
                await handleSaveCloud();
            }

            if (syncBackend === 'file') {
                const path = syncPath.trim();
                if (path) {
                    await SyncService.setSyncPath(path);
                }
            }

            await SyncService.performSync();
        } catch (error) {
            console.error('Sync failed:', error);
            setSyncError(String(error));
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCheckUpdates = async () => {
        setIsCheckingUpdate(true);
        setUpdateInfo(null);
        setUpdateError(null);
        try {
            const info = await checkForUpdates(appVersion);
            if (!info || !info.hasUpdate) {
                alert(t.upToDate);
                return;
            }
            setUpdateInfo(info);
            setShowUpdateModal(true);
        } catch (error) {
            console.error('Update check failed:', error);
            setUpdateError(String(error));
            alert(t.checkFailed);
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const handleDownloadUpdate = () => {
        if (updateInfo?.downloadUrl) {
            window.open(updateInfo.downloadUrl, '_blank');
        } else if (updateInfo?.releaseUrl) {
            window.open(updateInfo.releaseUrl, '_blank');
        } else {
            window.open(GITHUB_RELEASES_URL, '_blank');
        }
        setShowUpdateModal(false);
    };

    const labels = {
        en: {
            title: 'Settings',
            subtitle: 'Customize your Mindwtr experience',
            back: 'Back',
            appearance: 'Appearance',
            language: 'Language',
            keybindings: 'Keyboard Shortcuts',
            keybindingsDesc: 'Choose your preferred desktop keybinding style.',
            keybindingVim: 'Vim',
            keybindingEmacs: 'Emacs',
            viewShortcuts: 'View shortcuts',
            notifications: 'Notifications',
            notificationsDesc: 'Enable task reminders and daily digest notifications.',
            notificationsEnable: 'Enable notifications',
            dailyDigest: 'Daily Digest',
            dailyDigestDesc: 'Morning briefing and evening review prompts.',
            dailyDigestMorning: 'Morning briefing',
            dailyDigestEvening: 'Evening review',
            on: 'On',
            off: 'Off',
            localData: 'Local Data',
            localDataDesc: 'Data and config are stored under ~/.config/mindwtr/ (or platform equivalent).',
            webDataDesc: 'The web app stores data in browser storage.',
            sync: 'Sync',
            syncDescription:
                'Configure a secondary folder to sync your data with (e.g., Dropbox, Syncthing). This merges your local data with the sync folder to prevent data loss.',
            syncBackend: 'Sync backend',
            syncBackendFile: 'File',
            syncBackendWebdav: 'WebDAV',
            syncBackendCloud: 'Cloud',
            syncFolderLocation: 'Sync folder',
            savePath: 'Save',
            browse: 'Browse…',
            syncNow: 'Sync now',
            syncing: 'Syncing…',
            pathHint: 'Type a path directly (e.g., ~/Sync/mindwtr) or use Browse if available',
            webdavUrl: 'WebDAV URL',
            webdavUsername: 'Username',
            webdavPassword: 'Password',
            webdavSave: 'Save WebDAV',
            webdavHint: 'Use a full URL to your sync JSON file (e.g., https://example.com/remote.php/dav/files/user/data.json).',
            cloudUrl: 'Cloud URL',
            cloudToken: 'Access token',
            cloudSave: 'Save Cloud',
            cloudHint: 'Use your cloud endpoint URL (e.g., https://example.com/v1/data).',
            lastSync: 'Last sync',
            lastSyncNever: 'Never',
            lastSyncSuccess: 'Sync completed',
            lastSyncError: 'Sync failed',
            lastSyncConflicts: 'Conflicts',
            about: 'About',
            version: 'Version',
            developer: 'Developer',
            website: 'Website',
            github: 'GitHub',
            license: 'License',
            checkForUpdates: 'Check for Updates',
            checking: 'Checking…',
            upToDate: 'You are using the latest version!',
            updateAvailable: 'Update Available',
            checkFailed: 'Failed to check for updates',
            download: 'Download',
            changelog: 'Changelog',
            noChangelog: 'No changelog available',
            later: 'Later',
            saved: 'Settings saved',
            selectSyncFolderTitle: 'Select sync folder',
            system: 'System',
            light: 'Light',
            dark: 'Dark',
        },
        zh: {
            title: '设置',
            subtitle: '自定义您的 Mindwtr 体验',
            back: '返回',
            appearance: '外观',
            language: '语言',
            keybindings: '快捷键',
            keybindingsDesc: '选择桌面端偏好的快捷键风格。',
            keybindingVim: 'Vim',
            keybindingEmacs: 'Emacs',
            viewShortcuts: '查看快捷键',
            notifications: '通知',
            notificationsDesc: '启用任务提醒与每日简报通知。',
            notificationsEnable: '启用通知',
            dailyDigest: '每日简报',
            dailyDigestDesc: '早间简报与晚间回顾提醒。',
            dailyDigestMorning: '早间简报',
            dailyDigestEvening: '晚间回顾',
            on: '开启',
            off: '关闭',
            localData: '本地数据',
            localDataDesc: '数据与配置保存在 ~/.config/mindwtr/（或对应系统目录）。',
            webDataDesc: 'Web 版本使用浏览器存储。',
            sync: '同步',
            syncDescription:
                '配置一个辅助文件夹来同步您的数据（如 Dropbox、Syncthing）。这会将本地数据与同步文件夹合并，以防止数据丢失。',
            syncBackend: '同步后端',
            syncBackendFile: '文件',
            syncBackendWebdav: 'WebDAV',
            syncBackendCloud: '云端',
            syncFolderLocation: '同步文件夹',
            savePath: '保存',
            browse: '浏览…',
            syncNow: '立即同步',
            syncing: '同步中…',
            pathHint: '直接输入路径（如 ~/Sync/mindwtr）或点击浏览选择',
            webdavUrl: 'WebDAV 地址',
            webdavUsername: '用户名',
            webdavPassword: '密码',
            webdavSave: '保存 WebDAV',
            webdavHint: '请输入同步 JSON 文件的完整 URL（例如 https://example.com/remote.php/dav/files/user/data.json）。',
            cloudUrl: '云端地址',
            cloudToken: '访问令牌',
            cloudSave: '保存云端配置',
            cloudHint: '请填写云端同步端点（例如 https://example.com/v1/data）。',
            lastSync: '上次同步',
            lastSyncNever: '从未同步',
            lastSyncSuccess: '同步完成',
            lastSyncError: '同步失败',
            lastSyncConflicts: '冲突',
            about: '关于',
            version: '版本',
            developer: '开发者',
            website: '网站',
            github: 'GitHub',
            license: '许可证',
            checkForUpdates: '检查更新',
            checking: '检查中…',
            upToDate: '您正在使用最新版本！',
            updateAvailable: '有可用更新',
            checkFailed: '检查更新失败',
            download: '下载',
            changelog: '更新日志',
            noChangelog: '暂无更新日志',
            later: '稍后',
            saved: '设置已保存',
            selectSyncFolderTitle: '选择同步文件夹',
            system: '系统',
            light: '浅色',
            dark: '深色',
        },
    } as const;

    const t = labels[language];

    const lastSyncAt = settings?.lastSyncAt;
    const lastSyncStatus = settings?.lastSyncStatus;
    const lastSyncStats = settings?.lastSyncStats;
    const lastSyncDisplay = lastSyncAt ? safeFormatDate(lastSyncAt, 'PPpp', lastSyncAt) : t.lastSyncNever;
    const conflictCount = (lastSyncStats?.tasks.conflicts || 0) + (lastSyncStats?.projects.conflicts || 0);

    const themeSummary = themeMode === 'system' ? t.system : themeMode === 'light' ? t.light : t.dark;
    const languageSummary = LANGUAGES.find((l) => l.id === language)?.native || language;
    const keybindingSummary = keybindingStyle === 'vim' ? t.keybindingVim : t.keybindingEmacs;
    const notificationsSummary = notificationsEnabled ? t.on : t.off;
    const syncBackendSummary =
        syncBackend === 'file'
            ? t.syncBackendFile
            : syncBackend === 'webdav'
                ? t.syncBackendWebdav
                : t.syncBackendCloud;

    const pageTitle =
        page === 'appearance'
            ? t.appearance
            : page === 'language'
                ? t.language
                : page === 'keybindings'
                    ? t.keybindings
                    : page === 'notifications'
                        ? t.notifications
                        : page === 'sync'
                            ? t.sync
                            : page === 'about'
                                ? t.about
                                : t.title;

    const MenuRow = ({
        icon: Icon,
        title,
        value,
        onClick,
    }: {
        icon: ComponentType<{ className?: string }>;
        title: string;
        value?: string;
        onClick: () => void;
    }) => (
        <button onClick={onClick} className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-md bg-muted/50 border border-border">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="font-medium truncate">{title}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                {value && <span className="max-w-48 truncate">{value}</span>}
                <ChevronRight className="w-4 h-4" />
            </div>
        </button>
    );

    const renderMainMenu = () => (
        <>
            <header className="mb-8">
                <h1 className="text-3xl font-bold mb-2">{t.title}</h1>
                <p className="text-muted-foreground">{t.subtitle}</p>
            </header>

            <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
                <MenuRow icon={Monitor} title={t.appearance} value={themeSummary} onClick={() => setPage('appearance')} />
                <MenuRow icon={Globe} title={t.language} value={languageSummary} onClick={() => setPage('language')} />
                <MenuRow icon={Keyboard} title={t.keybindings} value={keybindingSummary} onClick={() => setPage('keybindings')} />
                <MenuRow
                    icon={Bell}
                    title={t.notifications}
                    value={notificationsSummary}
                    onClick={() => setPage('notifications')}
                />
                <MenuRow icon={Database} title={t.sync} value={`${syncBackendSummary} • ${lastSyncDisplay}`} onClick={() => setPage('sync')} />
                <MenuRow icon={Info} title={t.about} value={`v${appVersion}`} onClick={() => setPage('about')} />
            </div>
        </>
    );

    const renderSubHeader = () => (
        <header className="mb-8 flex items-center gap-3">
            <button
                onClick={() => setPage('main')}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/40"
            >
                <ArrowLeft className="w-4 h-4" />
                {t.back}
            </button>
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
        </header>
    );

    const renderPage = () => {
        if (page === 'appearance') {
            return (
                <div className="bg-card border border-border rounded-lg p-1">
                    <div className="grid grid-cols-3 gap-1">
                        <button
                            onClick={() => saveThemePreference('system')}
                            className={cn(
                                "flex flex-col items-center gap-3 p-4 rounded-md transition-all",
                                themeMode === 'system'
                                    ? "bg-primary/10 text-primary ring-2 ring-primary ring-inset"
                                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <div className="p-2 rounded-full border border-border bg-background">
                                <Monitor className="w-5 h-5" />
                            </div>
                            <span className="text-sm font-medium">{t.system}</span>
                        </button>
                        <button
                            onClick={() => saveThemePreference('light')}
                            className={cn(
                                "flex flex-col items-center gap-3 p-4 rounded-md transition-all",
                                themeMode === 'light'
                                    ? "bg-primary/10 text-primary ring-2 ring-primary ring-inset"
                                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <div className="p-2 rounded-full border border-border bg-background">
                                <Sun className="w-5 h-5" />
                            </div>
                            <span className="text-sm font-medium">{t.light}</span>
                        </button>
                        <button
                            onClick={() => saveThemePreference('dark')}
                            className={cn(
                                "flex flex-col items-center gap-3 p-4 rounded-md transition-all",
                                themeMode === 'dark'
                                    ? "bg-primary/10 text-primary ring-2 ring-primary ring-inset"
                                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <div className="p-2 rounded-full border border-border bg-slate-950 text-slate-50">
                                <Moon className="w-5 h-5" />
                            </div>
                            <span className="text-sm font-medium">{t.dark}</span>
                        </button>
                    </div>
                </div>
            );
        }

        if (page === 'language') {
            return (
                <div className="grid sm:grid-cols-2 gap-4">
                    {LANGUAGES.map((lang) => (
                        <button
                            key={lang.id}
                            onClick={() => saveLanguagePreference(lang.id)}
                            className={cn(
                                "flex items-center justify-between p-4 rounded-lg border transition-all",
                                language === lang.id
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "border-border hover:border-primary/50 hover:bg-muted/50",
                            )}
                        >
                            <span className="font-medium">{lang.native}</span>
                            {language === lang.id && <Check className="w-4 h-4 text-primary" />}
                        </button>
                    ))}
                </div>
            );
        }

        if (page === 'keybindings') {
            return (
                <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                    <p className="text-sm text-muted-foreground">{t.keybindingsDesc}</p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setKeybindingStyle('vim')}
                            className={cn(
                                "px-4 py-2 rounded-md text-sm font-medium transition-colors border",
                                keybindingStyle === 'vim'
                                    ? "bg-primary/10 text-primary border-primary ring-1 ring-primary"
                                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                            )}
                        >
                            {t.keybindingVim}
                        </button>
                        <button
                            onClick={() => setKeybindingStyle('emacs')}
                            className={cn(
                                "px-4 py-2 rounded-md text-sm font-medium transition-colors border",
                                keybindingStyle === 'emacs'
                                    ? "bg-primary/10 text-primary border-primary ring-1 ring-primary"
                                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                            )}
                        >
                            {t.keybindingEmacs}
                        </button>
                    </div>
                    <div className="flex justify-end">
                        <button onClick={openHelp} className="text-sm text-primary hover:underline">
                            {t.viewShortcuts}
                        </button>
                    </div>
                </div>
            );
        }

        if (page === 'notifications') {
            return (
                <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                    <p className="text-sm text-muted-foreground">{t.notificationsDesc}</p>

                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium">{t.notificationsEnable}</p>
                        </div>
                        <input
                            type="checkbox"
                            checked={notificationsEnabled}
                            onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked }).then(showSaved).catch(console.error)}
                            className="h-4 w-4 accent-blue-600"
                        />
                    </div>

                    <div className="border-t border-border/50"></div>

                    <div className="space-y-3">
                        <div>
                            <p className="text-sm font-medium">{t.dailyDigest}</p>
                            <p className="text-xs text-muted-foreground mt-1">{t.dailyDigestDesc}</p>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <div className="text-sm font-medium">{t.dailyDigestMorning}</div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="time"
                                    value={dailyDigestMorningTime}
                                    disabled={!notificationsEnabled || !dailyDigestMorningEnabled}
                                    onChange={(e) => updateSettings({ dailyDigestMorningTime: e.target.value }).then(showSaved).catch(console.error)}
                                    className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50"
                                />
                                <input
                                    type="checkbox"
                                    checked={dailyDigestMorningEnabled}
                                    disabled={!notificationsEnabled}
                                    onChange={(e) => updateSettings({ dailyDigestMorningEnabled: e.target.checked }).then(showSaved).catch(console.error)}
                                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <div className="text-sm font-medium">{t.dailyDigestEvening}</div>
                            <div className="flex items-center gap-3">
                                <input
                                    type="time"
                                    value={dailyDigestEveningTime}
                                    disabled={!notificationsEnabled || !dailyDigestEveningEnabled}
                                    onChange={(e) => updateSettings({ dailyDigestEveningTime: e.target.value }).then(showSaved).catch(console.error)}
                                    className="bg-muted px-2 py-1 rounded text-sm border border-border disabled:opacity-50"
                                />
                                <input
                                    type="checkbox"
                                    checked={dailyDigestEveningEnabled}
                                    disabled={!notificationsEnabled}
                                    onChange={(e) => updateSettings({ dailyDigestEveningEnabled: e.target.checked }).then(showSaved).catch(console.error)}
                                    className="h-4 w-4 accent-blue-600 disabled:opacity-50"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (page === 'sync') {
            const configPath = deriveConfigPath(dataPath);
            return (
                <div className="space-y-8">
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Database className="w-5 h-5" />
                            {t.localData}
                        </h2>
                        <div className="bg-card border border-border rounded-lg p-6 space-y-3">
                            <p className="text-sm text-muted-foreground">{isTauriRuntime() ? t.localDataDesc : t.webDataDesc}</p>
                            {isTauriRuntime() && dataPath && (
                                <div className="space-y-2 text-sm">
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="text-muted-foreground">data.json</span>
                                        <span className="font-mono text-xs break-all">{dataPath}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="text-muted-foreground">config.toml</span>
                                        <span className="font-mono text-xs break-all">{configPath}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <RefreshCw className="w-5 h-5" />
                            {t.sync}
                        </h2>

                        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                            <p className="text-sm text-muted-foreground">{t.syncDescription}</p>

                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm font-medium">{t.syncBackend}</span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleSetSyncBackend('file')}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                                            syncBackend === 'file'
                                                ? "bg-primary/10 text-primary border-primary ring-1 ring-primary"
                                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                                        )}
                                    >
                                        {t.syncBackendFile}
                                    </button>
                                    <button
                                        onClick={() => handleSetSyncBackend('webdav')}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                                            syncBackend === 'webdav'
                                                ? "bg-primary/10 text-primary border-primary ring-1 ring-primary"
                                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                                        )}
                                    >
                                        {t.syncBackendWebdav}
                                    </button>
                                    <button
                                        onClick={() => handleSetSyncBackend('cloud')}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                                            syncBackend === 'cloud'
                                                ? "bg-primary/10 text-primary border-primary ring-1 ring-primary"
                                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
                                        )}
                                    >
                                        {t.syncBackendCloud}
                                    </button>
                                </div>
                            </div>

                            {syncBackend === 'file' && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium">{t.syncFolderLocation}</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={syncPath}
                                            onChange={(e) => setSyncPath(e.target.value)}
                                            placeholder="/path/to/your/sync/folder"
                                            className="flex-1 bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            onClick={async () => {
                                                if (syncPath.trim()) {
                                                    const result = await SyncService.setSyncPath(syncPath.trim());
                                                    if (result.success) {
                                                        showSaved();
                                                    }
                                                }
                                            }}
                                            disabled={!syncPath.trim() || !isTauriRuntime()}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400 whitespace-nowrap"
                                        >
                                            {t.savePath}
                                        </button>
                                        <button
                                            onClick={handleChangeSyncLocation}
                                            disabled={!isTauriRuntime()}
                                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 whitespace-nowrap disabled:opacity-50"
                                        >
                                            {t.browse}
                                        </button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{t.pathHint}</p>
                                </div>
                            )}

                            {syncBackend === 'webdav' && (
                                <div className="space-y-3">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium">{t.webdavUrl}</label>
                                        <input
                                            type="text"
                                            value={webdavUrl}
                                            onChange={(e) => setWebdavUrl(e.target.value)}
                                            placeholder="https://example.com/remote.php/dav/files/user/data.json"
                                            className="bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <p className="text-xs text-muted-foreground">{t.webdavHint}</p>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-2">
                                        <div className="flex flex-col gap-2">
                                            <label className="text-sm font-medium">{t.webdavUsername}</label>
                                            <input
                                                type="text"
                                                value={webdavUsername}
                                                onChange={(e) => setWebdavUsername(e.target.value)}
                                                className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-sm font-medium">{t.webdavPassword}</label>
                                            <input
                                                type="password"
                                                value={webdavPassword}
                                                onChange={(e) => setWebdavPassword(e.target.value)}
                                                className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-end">
                                        <button
                                            onClick={handleSaveWebDav}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
                                        >
                                            {t.webdavSave}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {syncBackend === 'cloud' && (
                                <div className="space-y-3">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium">{t.cloudUrl}</label>
                                        <input
                                            type="text"
                                            value={cloudUrl}
                                            onChange={(e) => setCloudUrl(e.target.value)}
                                            placeholder="https://example.com/v1/data"
                                            className="bg-muted p-2 rounded text-sm font-mono border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <p className="text-xs text-muted-foreground">{t.cloudHint}</p>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium">{t.cloudToken}</label>
                                        <input
                                            type="password"
                                            value={cloudToken}
                                            onChange={(e) => setCloudToken(e.target.value)}
                                            className="bg-muted p-2 rounded text-sm border border-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div className="flex justify-end">
                                        <button
                                            onClick={handleSaveCloud}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
                                        >
                                            {t.cloudSave}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {(syncBackend === 'webdav'
                                ? !!webdavUrl.trim()
                                : syncBackend === 'cloud'
                                    ? !!cloudUrl.trim() && !!cloudToken.trim()
                                    : !!syncPath.trim()) && (
                                <div className="pt-2 flex items-center gap-3">
                                    <button
                                        onClick={handleSync}
                                        disabled={isSyncing}
                                        className={cn(
                                            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-colors",
                                            isSyncing ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700",
                                        )}
                                    >
                                        <ExternalLink className={cn("w-4 h-4", isSyncing && "animate-spin")} />
                                        {isSyncing ? t.syncing : t.syncNow}
                                    </button>
                                    {syncError && <span className="text-xs text-destructive">{syncError}</span>}
                                </div>
                            )}

                            <div className="pt-3 text-xs text-muted-foreground space-y-1">
                                <div>
                                    {t.lastSync}: {lastSyncDisplay}
                                    {lastSyncStatus === 'success' && ` • ${t.lastSyncSuccess}`}
                                    {lastSyncStatus === 'error' && ` • ${t.lastSyncError}`}
                                </div>
                                {lastSyncStats && (
                                    <div>
                                        {t.lastSyncConflicts}: {conflictCount} • Tasks {lastSyncStats.tasks.mergedTotal} /
                                        Projects {lastSyncStats.projects.mergedTotal}
                                    </div>
                                )}
                                {lastSyncStatus === 'error' && settings?.lastSyncError && (
                                    <div className="text-destructive">{settings.lastSyncError}</div>
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            );
        }

        if (page === 'about') {
            return (
                <div className="bg-muted/30 rounded-lg p-6 space-y-4 border border-border">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.version}</span>
                        <span className="font-mono bg-muted px-2 py-1 rounded text-sm">v{appVersion}</span>
                    </div>
                    <div className="border-t border-border/50"></div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.developer}</span>
                        <span className="font-medium">dongdongbh</span>
                    </div>
                    <div className="border-t border-border/50"></div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.license}</span>
                        <span className="font-medium">MIT</span>
                    </div>
                    <div className="border-t border-border/50"></div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.website}</span>
                        <button onClick={() => openLink('https://dongdongbh.tech')} className="text-primary hover:underline flex items-center gap-1">
                            dongdongbh.tech
                            <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="border-t border-border/50"></div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.github}</span>
                        <button
                            onClick={() => openLink('https://github.com/dongdongbh/Mindwtr')}
                            className="text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                        >
                            github.com/dongdongbh/Mindwtr
                            <ExternalLink className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="border-t border-border/50"></div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">{t.checkForUpdates}</span>
                        <button
                            onClick={handleCheckUpdates}
                            disabled={isCheckingUpdate}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                isCheckingUpdate
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                            )}
                        >
                            <RefreshCw className={cn("w-4 h-4", isCheckingUpdate && "animate-spin")} />
                            {isCheckingUpdate ? t.checking : t.checkForUpdates}
                        </button>
                    </div>
                    {updateError && (
                        <>
                            <div className="border-t border-border/50"></div>
                            <div className="text-red-500 text-sm">{t.checkFailed}</div>
                        </>
                    )}
                </div>
            );
        }

        return null;
    };

    return (
        <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
            {page === 'main' ? (
                renderMainMenu()
            ) : (
                <>
                    {renderSubHeader()}
                    {renderPage()}
                </>
            )}

            {saved && (
                <div className="fixed bottom-8 right-8 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2">
                    {t.saved}
                </div>
            )}

            {showUpdateModal && updateInfo && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
                        <div className="p-6 border-b border-border">
                            <h3 className="text-xl font-semibold text-green-500 flex items-center gap-2">{t.updateAvailable}</h3>
                            <p className="text-muted-foreground mt-1">
                                v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
                            </p>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            <h4 className="font-medium mb-2">{t.changelog}</h4>
                            <div className="bg-muted/50 rounded-md p-4 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                                {updateInfo.releaseNotes || t.noChangelog}
                            </div>
                        </div>
                        <div className="p-6 border-t border-border flex gap-3 justify-end">
                            <button
                                onClick={() => setShowUpdateModal(false)}
                                className="px-4 py-2 rounded-md text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
                            >
                                {t.later}
                            </button>
                            <button
                                onClick={handleDownloadUpdate}
                                className="px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                                <ExternalLink className="w-4 h-4" />
                                {t.download}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
