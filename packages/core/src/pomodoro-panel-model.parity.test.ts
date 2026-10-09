/**
 * Core's Pomodoro card model replayed against React Native's frozen card
 * (pomodoro-panel-parity.fixtures.json, captured at dba1097c7 by
 * apps/mobile/components/pomodoro-panel.parity.test.tsx). Each step draws the model
 * from the session RN's card read at that step, the way RN lays the card out, and
 * presses the same control: every text, every button's label and disabled flag, the
 * active preset, the fold, the task picker, and the controller call, fold write and
 * Task done each control made must match what RN's card did before core held its
 * policy. Colors are RN's theme, not the model's, so they are left out.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import type { MobilePomodoroControllerState } from './pomodoro-controller';
import {
    buildPomodoroPanelModel,
    getPomodoroAutoStartOptions,
    isPomodoroLinkedTaskGone,
    type PomodoroPanelAction,
    type PomodoroPanelModel,
} from './pomodoro-panel-model';
import { loadScreenFixture, normalize } from './screen-parity.replay';
import type { AppSettings, Task } from './types';

type Button = [string, boolean, number, string | null, boolean | null];
type Observation = {
    texts: [string, string | null][];
    buttons: Button[];
    icons: string[];
    spinners: number;
    runningDot: boolean;
    modal: {
        texts: [string, string | null][];
        buttons: Button[];
        list: { empty: { texts: [string, string | null][] } | null; rows: { texts: [string, string | null][]; buttons: Button[] }[] } | null;
    } | null;
    controller: unknown[][];
    device: unknown[][];
    markedDone: string[];
    session: MobilePomodoroControllerState;
};
type Scenario = {
    name: string;
    settings: string;
    device: { language?: string; session?: string; collapsed?: string; hold?: boolean };
    pickerTasks: string[];
    actions: [string, ...unknown[]][];
};
type Fixture = {
    now: string;
    tasks: Task[];
    settings: Record<string, AppSettings>;
    sessions: Record<string, { selectedTaskId?: string }>;
    scenarios: Scenario[];
    observations: Record<string, Observation[]>;
};

const fixture = loadScreenFixture<Fixture>('pomodoro-panel');
const strings: Record<string, Record<string, string>> = {};
const TINT = '#3b82f6';
const COLLAPSED_KEY = '@mindwtr_pomodoro_collapsed';

/** The model laid out as RN's card draws it. */
function draw(model: PomodoroPanelModel, pickerTasks: Task[], selectedTaskId: string | undefined, pickerOpen: boolean) {
    const off = model.loading !== null;
    if (model.collapsed) {
        return {
            texts: [model.clock, model.status],
            buttons: [[model.collapseToggle.label, false]],
            presets: [],
            icons: ['Icon:ChevronDown'],
            spinners: 0,
            runningDot: model.running,
            modal: null,
        };
    }
    const link = model.link;
    return {
        texts: [
            model.title, model.phaseLabel, ...(model.loading ? [model.loading] : []), ...model.presets.map((preset) => preset.label),
            model.clock, model.sessions,
            ...(link ? [link.label, link.value, link.changeLabel, ...(link.markDone ? [link.markDone.label] : [])] : []),
            model.primary.label, model.reset.label, model.switchPhase.label, ...(model.event ? [model.event] : []),
        ],
        buttons: [
            [model.collapseToggle.label, false],
            ...model.presets.map((preset) => [preset.label, off]),
            ...(link ? [[link.label, false], ...(link.markDone ? [[link.markDone.accessibilityLabel, off]] : [])] : []),
            [model.primary.label, off], [model.reset.label, off], [model.switchPhase.label, off],
        ],
        presets: model.presets.map((preset) => [preset.label, preset.active]),
        icons: ['Icon:ChevronUp'],
        spinners: off ? 1 : 0,
        runningDot: false,
        modal: link && pickerOpen ? {
            texts: [model.picker.title, model.picker.timerOnly.label],
            // The scrim behind the sheet closes it; it has no words.
            buttons: [['', false, null], [model.picker.timerOnly.label, false, model.picker.timerOnly.selected]],
            list: pickerTasks.length === 0
                ? { empty: [model.picker.empty], rows: [] }
                : { empty: null, rows: pickerTasks.map((task) => [task.title, task.id === selectedTaskId]) },
        } : null,
    };
}

/** What RN's card asks the controller (and the screen) for, per model action. */
function calls(action: PomodoroPanelAction, options: unknown) {
    switch (action.type) {
        case 'run': return { controller: [['toggle', options]] };
        case 'reset': return { controller: [['reset', options]] };
        case 'phase': return { controller: [['switchPhase', options]] };
        case 'preset': return { controller: [['setDurations', { focusMinutes: action.focusMinutes, breakMinutes: action.breakMinutes }, options]] };
        case 'selectTask': return { controller: [['setSelectedTaskId', action.taskId ?? '<undefined>']] };
        case 'markDone': return { controller: [['clearLastEvent']], markedDone: [action.taskId] };
        case 'collapse': return { device: [['setItem', COLLAPSED_KEY, String(action.value)]] };
        default: throw new Error('unknown action');
    }
}

describe('core\'s Pomodoro card model against RN\'s frozen card', () => {
    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
        strings.en = await loadTranslations('en');
        strings.de = await loadTranslations('de');
    });
    afterAll(() => { vi.useRealTimers(); });

    it.each(fixture.scenarios.map((scenario) => [scenario.name, scenario] as const))('%s', (_name, scenario) => {
        const language = scenario.device.language ?? 'en';
        const t = (key: string) => strings[language]?.[key] || strings.en?.[key] || key;
        const settings = fixture.settings[scenario.settings];
        const options = normalize(getPomodoroAutoStartOptions(settings));
        const pickerTasks = scenario.pickerTasks.map((id) => fixture.tasks.find((task) => task.id === id)!);
        const frozen = fixture.observations[scenario.name];
        let collapsed = scenario.device.collapsed === 'true';
        let pickerOpen = false;
        const label = (text: string) => (text.startsWith('k:') ? t(text.slice(2)) : text);
        // The fixture writes an absent value as '<undefined>'.
        const session = (step: number): MobilePomodoroControllerState => JSON.parse(JSON.stringify(frozen[step].session),
            (_key, entry) => (entry === '<undefined>' ? undefined : entry));
        const build = (step: number) => buildPomodoroPanelModel({ session: session(step), settings, tasks: fixture.tasks, collapsed, t });

        const compare = (step: number, expected: { controller?: unknown[][]; device?: unknown[][]; markedDone?: string[] }) => {
            const seen = frozen[step];
            const drawn = draw(build(step), pickerTasks, session(step).selectedTaskId, pickerOpen);
            const tinted = new Set(drawn.presets.map(([text]) => text));
            expect({
                step, texts: drawn.texts, buttons: drawn.buttons, presets: drawn.presets, icons: drawn.icons, spinners: drawn.spinners,
                runningDot: drawn.runningDot, modal: drawn.modal,
                controller: expected.controller ?? [], device: expected.device ?? [], markedDone: expected.markedDone ?? [],
            }).toEqual({
                step,
                texts: seen.texts.map(([text]) => text),
                buttons: seen.buttons.map(([text, disabled]) => [text, disabled]),
                presets: seen.buttons.filter(([text]) => tinted.has(text)).map(([text, , , fill]) => [text, fill === TINT]),
                icons: seen.icons, spinners: seen.spinners, runningDot: seen.runningDot,
                modal: seen.modal && {
                    texts: seen.modal.texts.map(([text]) => text),
                    buttons: seen.modal.buttons.map(([text, disabled, , , selected]) => [text, disabled, selected]),
                    list: seen.modal.list && {
                        empty: seen.modal.list.empty && seen.modal.list.empty.texts.map(([text]) => text),
                        rows: seen.modal.list.rows.map((row) => [row.texts[0][0], row.buttons[0][4]]),
                    },
                },
                controller: seen.controller, device: seen.device, markedDone: seen.markedDone,
            });
        };

        // On first draw the card hydrates the session, then drops a linked task that is no longer there.
        const stored = scenario.device.session ? fixture.sessions[scenario.device.session] : {};
        const gone = isPomodoroLinkedTaskGone({ ...session(0), selectedTaskId: stored.selectedTaskId }, settings, fixture.tasks);
        compare(0, { controller: [['ensureHydrated', options], ...(gone ? [['setSelectedTaskId', '<undefined>']] : [])] });

        scenario.actions.forEach(([kind, target], index) => {
            const model = build(index);
            const off = model.loading !== null;
            let expected: ReturnType<typeof calls> | Record<string, never> = {};
            if (kind === 'press') {
                const text = label(target as string);
                const preset = model.collapsed ? undefined : model.presets.find((item) => item.label === text);
                if (text === model.collapseToggle.label) {
                    expected = calls(model.collapseToggle.action, options);
                    collapsed = !collapsed;
                } else if (model.link && text === model.link.label) {
                    pickerOpen = true;
                } else if (off) {
                    // Every other control is off while the session loads.
                } else if (preset) {
                    expected = calls(preset.action, options);
                } else if (model.link?.markDone && text === model.link.markDone.accessibilityLabel) {
                    expected = calls(model.link.markDone.action, options);
                } else {
                    const control = [model.primary, model.reset, model.switchPhase].find((item) => item.label === text)!;
                    expected = calls(control.action, options);
                }
            } else if (kind === 'modalPress') {
                expect(label(target as string)).toBe(model.picker.timerOnly.label);
                expected = calls(model.picker.timerOnly.action, options);
                pickerOpen = false;
            } else if (kind === 'pickTask') {
                expected = calls({ type: 'selectTask', taskId: target as string }, options);
                pickerOpen = false;
            } else if (kind === 'dismiss') {
                pickerOpen = false;
            } else if (kind !== 'release') {
                throw new Error(`Unknown action ${kind}`);
            }
            compare(index + 1, expected);
        });
    });
});
