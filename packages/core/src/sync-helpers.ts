import type { AppData, Attachment } from './types';

const SYNC_FILE_NAME = 'data.json';

export const normalizeWebdavUrl = (rawUrl: string): string => {
    const trimmed = rawUrl.replace(/\/+$/, '');
    return trimmed.toLowerCase().endsWith(`/${SYNC_FILE_NAME}`) || trimmed.toLowerCase().endsWith('.json')
        ? trimmed
        : `${trimmed}/${SYNC_FILE_NAME}`;
};

export const normalizeCloudUrl = (rawUrl: string): string => {
    const trimmed = rawUrl.replace(/\/+$/, '');
    return trimmed.toLowerCase().endsWith('/data') ? trimmed : `${trimmed}/data`;
};

export const sanitizeAppDataForRemote = (data: AppData): AppData => {
    const sanitizeAttachments = (attachments?: Attachment[]): Attachment[] | undefined => {
        if (!attachments) return attachments;
        return attachments.map((attachment) => {
            if (attachment.kind !== 'file') return attachment;
            return {
                ...attachment,
                uri: '',
                localStatus: undefined,
            };
        });
    };

    const sanitizeSettingsForRemote = (settings: AppData['settings']): AppData['settings'] => {
        const prefs = settings.syncPreferences ?? {};
        const next: AppData['settings'] = { ...settings };

        if (prefs.appearance !== true) {
            next.theme = undefined;
            next.appearance = undefined;
            next.keybindingStyle = undefined;
        }

        if (prefs.language !== true) {
            next.language = undefined;
            next.weekStart = undefined;
            next.dateFormat = undefined;
        }

        if (prefs.externalCalendars !== true) {
            next.externalCalendars = undefined;
        }

        if (prefs.ai !== true) {
            next.ai = undefined;
        } else if (next.ai) {
            next.ai = {
                ...next.ai,
                apiKey: undefined,
                speechToText: next.ai.speechToText
                    ? {
                        ...next.ai.speechToText,
                        offlineModelPath: undefined,
                    }
                    : next.ai.speechToText,
            };
        }

        return next;
    };

    return {
        ...data,
        tasks: data.tasks.map((task) => ({
            ...task,
            attachments: sanitizeAttachments(task.attachments),
        })),
        projects: data.projects.map((project) => ({
            ...project,
            attachments: sanitizeAttachments(project.attachments),
        })),
        settings: sanitizeSettingsForRemote(data.settings),
    };
};
