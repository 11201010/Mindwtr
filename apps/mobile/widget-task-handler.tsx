import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetTaskHandler, type WidgetTaskHandler } from 'react-native-android-widget';
import { applyTaskUpdates, generateUUID, type AppData } from '@mindwtr/core';

import { buildTasksWidgetTree } from './components/TasksWidget';
import {
    buildWidgetPayload,
    resolveWidgetLanguage,
    WIDGET_DATA_KEY,
    WIDGET_LANGUAGE_KEY,
} from './lib/widget-data';
import { logWarn } from './lib/app-log';
import { mobileStorage } from './lib/storage-adapter';

const DEFAULT_DATA: AppData = { tasks: [], projects: [], sections: [], areas: [], settings: {} };
const COMPLETE_TASK_ACTION = 'COMPLETE_TASK';

const ensureDeviceId = (settings: AppData['settings']) => {
    if (settings.deviceId) {
        return { settings, deviceId: settings.deviceId, updated: false };
    }
    const deviceId = generateUUID();
    return { settings: { ...settings, deviceId }, deviceId, updated: true };
};

const completeTaskFromWidget = async (taskId: string): Promise<AppData | null> => {
    try {
        const data = await mobileStorage.getData();
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        const targetIndex = tasks.findIndex((task) => task.id === taskId && !task.deletedAt);
        if (targetIndex < 0) return null;
        const target = tasks[targetIndex];
        if (target.status === 'done' || target.status === 'archived') return data;
        const now = new Date().toISOString();
        const { settings, deviceId, updated } = ensureDeviceId(data.settings ?? {});
        const { updatedTask, nextRecurringTask } = applyTaskUpdates(
            target,
            {
                status: 'done',
                rev: (Number.isFinite(target.rev) ? (target.rev as number) : 0) + 1,
                revBy: deviceId,
            },
            now
        );
        const nextTasks = tasks.map((task) => (task.id === taskId ? updatedTask : task));
        if (nextRecurringTask) nextTasks.push(nextRecurringTask);
        const nextData: AppData = {
            ...data,
            tasks: nextTasks,
            settings: updated ? settings : data.settings,
        };
        await mobileStorage.saveData(nextData);
        return nextData;
    } catch (error) {
        void logWarn('[RNWidget] Failed to complete task from widget', {
            scope: 'widget',
            extra: { error: error instanceof Error ? error.message : String(error), taskId },
        });
        return null;
    }
};

async function loadWidgetContext() {
    try {
        const [rawData, rawLanguage] = await Promise.all([
            AsyncStorage.getItem(WIDGET_DATA_KEY),
            AsyncStorage.getItem(WIDGET_LANGUAGE_KEY),
        ]);

        let data = DEFAULT_DATA;
        if (rawData) {
            try {
                data = JSON.parse(rawData) as AppData;
            } catch {
                data = DEFAULT_DATA;
            }
        }

        const language = resolveWidgetLanguage(rawLanguage, data.settings?.language);
        return { data, language };
    } catch (error) {
        if (__DEV__) {
            void logWarn('[RNWidget] Failed to load widget payload', {
                scope: 'widget',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
        }
        return { data: DEFAULT_DATA, language: 'en' as const };
    }
}

const widgetTaskHandler: WidgetTaskHandler = async ({ renderWidget, widgetInfo, widgetAction, clickAction, clickActionData }) => {
    let { data, language } = await loadWidgetContext();
    if (widgetAction === 'WIDGET_CLICK' && clickAction === COMPLETE_TASK_ACTION) {
        const taskId = typeof clickActionData?.taskId === 'string' ? clickActionData.taskId : '';
        if (taskId) {
            const updatedData = await completeTaskFromWidget(taskId);
            if (updatedData) {
                data = updatedData;
            }
        }
    }
    const tasksPayload = buildWidgetPayload(data, language);
    try {
        renderWidget(buildTasksWidgetTree(tasksPayload));
    } catch (error) {
        if (__DEV__) {
            void logWarn('[RNWidget] Widget render failed', {
                scope: 'widget',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
        }
        renderWidget(buildTasksWidgetTree(tasksPayload));
    }

    if (widgetInfo.width <= 0 || widgetInfo.height <= 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        renderWidget(buildTasksWidgetTree(tasksPayload));
    }
};

registerWidgetTaskHandler(widgetTaskHandler);
