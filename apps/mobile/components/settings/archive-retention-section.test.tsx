import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    days: 0,
    save: vi.fn(async (_days: number) => ({ success: true })),
    preview: vi.fn(() => ({ taskIds: ['task-1'], projectIds: [], sectionIds: [], legacyTaskIds: ['old-1'], legacyProjectIds: [] })),
}));

vi.mock('@mindwtr/core', () => ({
    isArchiveRetentionDays: (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36500,
    getArchiveRetentionPreview: harness.preview,
    useTaskStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector({ settings: { gtd: { archiveRetentionDays: harness.days } } }),
        { getState: () => ({
            _allTasks: [{ id: 'task-1', title: 'Review me' }], _allProjects: [], _allSections: [],
            setArchiveRetentionDays: harness.save,
        }) },
    ),
}));
vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({ cardBg: '#fff', border: '#ddd', text: '#111', secondaryText: '#666', tint: '#06f' }),
}));
vi.mock('./settings.hooks', () => ({
    useSettingsLocalization: () => ({ tr: (key: string, values?: Record<string, number>) =>
        `${key}${values ? ` ${Object.values(values).join(',')}` : ''}` }),
}));

import { ArchiveRetentionSection } from './archive-retention-section';

const button = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAllByType(TouchableOpacity)
    .find((node) => node.findAllByType(Text).some((text) => text.props.children === label))!;

describe('ArchiveRetentionSection mobile', () => {
    beforeEach(() => { harness.days = 0; harness.save.mockClear(); harness.preview.mockClear(); });

    it('keeps invalid values disabled and requires candidate review before enabling', async () => {
        let tree!: renderer.ReactTestRenderer;
        await act(async () => { tree = renderer.create(<ArchiveRetentionSection />); });
        const input = tree.root.findByType(TextInput);
        expect(button(tree, 'settings.archiveRetentionSave').props.disabled).toBe(true);
        await act(async () => input.props.onChangeText('1.5'));
        expect(button(tree, 'settings.archiveRetentionSave').props.disabled).toBe(true);
        await act(async () => input.props.onChangeText('30'));
        await act(async () => button(tree, 'settings.archiveRetentionSave').props.onPress());
        expect(harness.save).not.toHaveBeenCalled();
        expect(tree.root.findAllByType(Text).some((node) => node.props.children === 'calendar.tasks: Review me')).toBe(true);
        await act(async () => button(tree, 'common.cancel').props.onPress());
        expect(harness.save).not.toHaveBeenCalled();
        await act(async () => button(tree, 'settings.archiveRetentionSave').props.onPress());
        await act(async () => button(tree, 'settings.archiveRetentionConfirmAction').props.onPress());
        expect(harness.save).toHaveBeenCalledWith(30);
        await act(async () => tree.unmount());
    });

    it('reviews a shorter policy before saving', async () => {
        harness.days = 90;
        let tree!: renderer.ReactTestRenderer;
        await act(async () => { tree = renderer.create(<ArchiveRetentionSection />); });
        await act(async () => tree.root.findByType(TextInput).props.onChangeText('30'));
        await act(async () => button(tree, 'settings.archiveRetentionSave').props.onPress());
        expect(harness.save).not.toHaveBeenCalled();
        expect(tree.root.findAllByType(Text).some((node) => node.props.children === 'settings.archiveRetentionConfirmTitle')).toBe(true);
        await act(async () => tree.unmount());
    });
});
