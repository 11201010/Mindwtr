import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Language = 'en' | 'zh';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
    en: {
        // App
        'app.name': 'Focus GTD',

        // Navigation
        'nav.main': 'Main',
        'nav.board': 'Board View',
        'nav.calendar': 'Calendar',
        'nav.contexts': 'Contexts',
        'nav.waiting': 'Waiting For',
        'nav.someday': 'Someday/Maybe',
        'nav.projects': 'Projects',
        'nav.archived': 'Archived',
        'nav.settings': 'Settings',

        // Tabs
        'tab.inbox': 'Inbox',
        'tab.next': 'Next',
        'tab.agenda': 'Agenda',
        'tab.review': 'Review',

        // Inbox
        'inbox.title': 'Inbox',
        'inbox.processButton': 'Process Inbox',
        'inbox.addPlaceholder': 'Add task to inbox...',
        'inbox.empty': 'No tasks in inbox',
        'inbox.isActionable': 'Is this actionable?',
        'inbox.actionableHint': 'Can you take a physical action on this?',
        'inbox.yes': 'Yes',
        'inbox.no': 'No',
        'inbox.trash': 'Trash',
        'inbox.someday': 'Someday',
        'inbox.twoMinRule': 'Will it take less than 2 minutes?',
        'inbox.twoMinHint': 'If yes, do it now!',
        'inbox.doneIt': 'Done it!',
        'inbox.takesLonger': 'Takes longer',
        'inbox.whatNext': "What's next?",
        'inbox.illDoIt': "I'll do it",
        'inbox.delegate': 'Delegate',
        'inbox.whereDoIt': 'Where will you do this?',
        'inbox.addContext': 'Add a context to find it later',
        'inbox.skip': 'Skip',

        // Next Actions
        'next.title': 'Next Actions',
        'next.ready': 'tasks ready to go',
        'next.current': 'Current Actions',
        'next.promote': 'Ready to Promote',
        'next.promoteHint': 'Tap arrow to move to Next Actions',
        'next.noTasks': 'No tasks in Todo. Add to Inbox and process first.',
        'next.noContext': 'No Next Actions with',

        // Agenda
        'agenda.title': 'My Agenda',
        'agenda.active': 'active tasks',
        'agenda.inProgress': 'In Progress',
        'agenda.overdue': 'Overdue',
        'agenda.dueToday': 'Due Today',
        'agenda.nextActions': 'Next Actions',
        'agenda.upcoming': 'Upcoming',
        'agenda.allClear': 'All Clear!',
        'agenda.noTasks': 'No active tasks. Add some tasks to get started.',

        // Review
        'review.title': 'Review Tasks',
        'review.noTasks': 'No tasks to review',
        'review.notSet': 'Not set',
        'review.description': 'Description',
        'review.startTime': 'Start Time',
        'review.deadline': 'Deadline',
        'review.contexts': 'Contexts',
        'review.markDone': 'Mark Done',

        // Board
        'board.title': 'Board View',
        'board.todo': 'Todo',
        'board.inProgress': 'In Progress',
        'board.done': 'Done',
        'board.noTasks': 'No tasks',

        // Calendar
        'calendar.title': 'Calendar',
        'calendar.addTask': 'Add new task...',
        'calendar.noTasks': 'No tasks for this day',

        // Contexts
        'contexts.title': 'Contexts',
        'contexts.filter': 'Filter tasks by context',
        'contexts.all': 'All Contexts',
        'contexts.noContexts': 'No contexts found. Add contexts like @home, @work, @computer to your tasks',
        'contexts.noTasks': 'No active tasks for this context',

        // Waiting
        'waiting.title': 'Waiting For',
        'waiting.subtitle': 'Tasks waiting on someone else or external events',
        'waiting.count': 'Waiting',
        'waiting.withDeadline': 'With Deadline',
        'waiting.moveToNext': 'Move to Next',
        'waiting.markDone': 'Mark Done',
        'waiting.empty': 'No waiting tasks',
        'waiting.emptyHint': 'Use "Waiting" status for tasks that depend on others or external events',

        // Someday
        'someday.title': 'Someday/Maybe',
        'someday.subtitle': 'Ideas and goals you might want to pursue in the future',
        'someday.ideas': 'Ideas',
        'someday.inProjects': 'In Projects',
        'someday.moveToNext': 'Move to Next',
        'someday.archive': 'Archive',
        'someday.empty': 'No someday/maybe items',
        'someday.emptyHint': 'Use "Someday" status for ideas, goals, and projects you might want to do in the future',

        // Projects
        'projects.title': 'Projects',
        'projects.count': 'projects',
        'projects.addPlaceholder': 'Add new project...',
        'projects.add': 'Add',
        'projects.empty': 'No projects yet',
        'projects.back': '← Back',

        // Settings
        'settings.title': 'Settings',
        'settings.appearance': 'Appearance',
        'settings.useSystem': 'Use System Theme',
        'settings.followDevice': 'Follow device appearance settings',
        'settings.darkMode': 'Dark Mode',
        'settings.darkEnabled': 'Dark theme enabled',
        'settings.lightEnabled': 'Light theme enabled',
        'settings.language': 'Language',
        'settings.selectLang': 'Select your preferred language',
        'settings.about': 'About',
        'settings.version': 'Version',
        'settings.dataSync': 'Data & Sync',
        'settings.dataDesc': 'Import or export your data to sync with other devices.',
        'settings.importData': 'Import Data',
        'settings.exportData': 'Export Data',
        'settings.importSuccess': 'Data imported successfully!',
        'settings.exportSuccess': 'Data exported successfully!',

        // Common
        'common.tasks': 'tasks',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.delete': 'Delete',
        'common.edit': 'Edit',
        'common.add': 'Add',
        'common.all': 'All',

        // Archived
        'archived.title': 'Archived',
        'archived.empty': 'No archived tasks',
        'archived.emptyHint': 'Tasks you archive will appear here',
        'contexts.search': 'Search contexts...',
    },
    zh: {
        // App
        'app.name': 'Focus GTD',

        // Navigation
        'nav.main': '主页',
        'nav.board': '看板',
        'nav.calendar': '日历',
        'nav.contexts': '情境',
        'nav.waiting': '等待中',
        'nav.someday': '将来/也许',
        'nav.projects': '项目',
        'nav.archived': '归档',
        'nav.settings': '设置',

        // Tabs
        'tab.inbox': '收集箱',
        'tab.next': '下一步',
        'tab.agenda': '日程',
        'tab.review': '回顾',

        // Inbox
        'inbox.title': '收集箱',
        'inbox.processButton': '处理收集箱',
        'inbox.addPlaceholder': '添加任务到收集箱...',
        'inbox.empty': '收集箱中没有任务',
        'inbox.isActionable': '这是可执行的吗？',
        'inbox.actionableHint': '你能对此采取实际行动吗？',
        'inbox.yes': '是',
        'inbox.no': '否',
        'inbox.trash': '删除',
        'inbox.someday': '将来',
        'inbox.twoMinRule': '两分钟内能完成吗？',
        'inbox.twoMinHint': '如果是，现在就做！',
        'inbox.doneIt': '已完成！',
        'inbox.takesLonger': '需要更长时间',
        'inbox.whatNext': '下一步怎么做？',
        'inbox.illDoIt': '我来做',
        'inbox.delegate': '委派他人',
        'inbox.whereDoIt': '你会在哪里做这件事？',
        'inbox.addContext': '添加情境以便之后找到',
        'inbox.skip': '跳过',

        // Next Actions
        'next.title': '下一步行动',
        'next.ready': '个任务准备就绪',
        'next.current': '当前行动',
        'next.promote': '准备提升',
        'next.promoteHint': '点击箭头移动到下一步行动',
        'next.noTasks': '待办中没有任务。请先添加到收集箱并处理。',
        'next.noContext': '没有此情境的下一步行动',

        // Agenda
        'agenda.title': '我的日程',
        'agenda.active': '个活跃任务',
        'agenda.inProgress': '进行中',
        'agenda.overdue': '已过期',
        'agenda.dueToday': '今天到期',
        'agenda.nextActions': '下一步行动',
        'agenda.upcoming': '即将到来',
        'agenda.allClear': '全部完成！',
        'agenda.noTasks': '没有活跃任务。添加一些任务开始吧。',

        // Review
        'review.title': '回顾任务',
        'review.noTasks': '没有需要回顾的任务',
        'review.notSet': '未设置',
        'review.description': '描述',
        'review.startTime': '开始时间',
        'review.deadline': '截止时间',
        'review.contexts': '情境',
        'review.markDone': '标记完成',

        // Board
        'board.title': '看板',
        'board.todo': '待办',
        'board.inProgress': '进行中',
        'board.done': '已完成',
        'board.noTasks': '没有任务',

        // Calendar
        'calendar.title': '日历',
        'calendar.addTask': '添加新任务...',
        'calendar.noTasks': '这一天没有任务',

        // Contexts
        'contexts.title': '情境',
        'contexts.filter': '按情境筛选任务',
        'contexts.all': '所有情境',
        'contexts.noContexts': '未找到情境。为任务添加 @家, @工作, @电脑 等情境',
        'contexts.noTasks': '此情境没有活跃任务',

        // Waiting
        'waiting.title': '等待中',
        'waiting.subtitle': '等待他人或外部事件的任务',
        'waiting.count': '等待中',
        'waiting.withDeadline': '有截止日期',
        'waiting.moveToNext': '移至下一步',
        'waiting.markDone': '标记完成',
        'waiting.empty': '没有等待中的任务',
        'waiting.emptyHint': '使用"等待中"状态标记依赖他人或外部事件的任务',

        // Someday
        'someday.title': '将来/也许',
        'someday.subtitle': '未来可能想要追求的想法和目标',
        'someday.ideas': '想法',
        'someday.inProjects': '在项目中',
        'someday.moveToNext': '移至下一步',
        'someday.archive': '归档',
        'someday.empty': '没有将来/也许项目',
        'someday.emptyHint': '使用"将来"状态存储未来可能想做的想法、目标和项目',

        // Projects
        'projects.title': '项目',
        'projects.count': '个项目',
        'projects.addPlaceholder': '添加新项目...',
        'projects.add': '添加',
        'projects.empty': '还没有项目',
        'projects.back': '← 返回',

        // Settings
        'settings.title': '设置',
        'settings.appearance': '外观',
        'settings.useSystem': '跟随系统',
        'settings.followDevice': '跟随设备外观设置',
        'settings.darkMode': '深色模式',
        'settings.darkEnabled': '已启用深色主题',
        'settings.lightEnabled': '已启用浅色主题',
        'settings.language': '语言',
        'settings.selectLang': '选择您的首选语言',
        'settings.about': '关于',
        'settings.version': '版本',
        'settings.dataSync': '数据与同步',
        'settings.dataDesc': '导入或导出数据以与其他设备同步。',
        'settings.importData': '导入数据',
        'settings.exportData': '导出数据',
        'settings.importSuccess': '数据导入成功！',
        'settings.exportSuccess': '数据导出成功！',

        // Common
        'common.tasks': '个任务',
        'common.cancel': '取消',
        'common.save': '保存',
        'common.delete': '删除',
        'common.edit': '编辑',
        'common.add': '添加',
        'common.all': '全部',

        // Archived
        'archived.title': '归档',
        'archived.empty': '没有归档的任务',
        'archived.emptyHint': '你归档的任务将会显示在这里',
        'contexts.search': '搜索情境...',
    },
};

const LANGUAGE_STORAGE_KEY = 'focus-gtd-language';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguageState] = useState<Language>('en');

    useEffect(() => {
        loadLanguage();
    }, []);

    const loadLanguage = async () => {
        try {
            const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
            if (saved === 'en' || saved === 'zh') {
                setLanguageState(saved);
            }
        } catch (error) {
            console.error('Failed to load language', error);
        }
    };

    const setLanguage = async (lang: Language) => {
        try {
            await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
            setLanguageState(lang);
        } catch (error) {
            console.error('Failed to save language', error);
        }
    };

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
