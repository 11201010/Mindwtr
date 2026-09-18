import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewControls } from './ViewControls';

const t = (key: string) => ({
    'common.viewOptions': 'View options',
    'list.groupBy': 'Group',
    'list.groupByNone': 'No grouping',
    'list.groupByProject': 'Project',
    'sort.default': 'Default',
    'sort.label': 'Sort',
    'sort.title': 'Title',
}[key] ?? key);

const renderControls = (sortBy: 'default' | 'title', groupBy: 'none' | 'project') => (
    <ViewControls
        sortBy={sortBy}
        defaultSortBy="default"
        onChangeSortBy={vi.fn()}
        groupBy={groupBy}
        defaultGroupBy="none"
        groupByOptions={['none', 'project']}
        onChangeGroupBy={vi.fn()}
        t={t}
    />
);

describe('ViewControls', () => {
    it('shows Sort and Group directly with no View options step', () => {
        const view = render(renderControls('default', 'none'));

        expect(view.getByRole('combobox', { name: 'Sort' })).toBeVisible();
        expect(view.getByRole('combobox', { name: 'Group' })).toBeVisible();
        expect(view.queryByRole('button', { name: 'View options' })).not.toBeInTheDocument();
        expect(view.queryByText('Density')).not.toBeInTheDocument();
    });

    it('highlights only the control whose value differs from its supplied default', () => {
        const view = render(renderControls('default', 'none'));
        const sort = view.getByRole('combobox', { name: 'Sort' });
        const group = view.getByRole('combobox', { name: 'Group' });

        expect(sort).toHaveClass('bg-card');
        expect(group).toHaveClass('bg-card');

        view.rerender(renderControls('title', 'none'));
        expect(sort).toHaveClass('bg-primary/10');
        expect(group).toHaveClass('bg-card');

        view.rerender(renderControls('default', 'project'));
        expect(sort).toHaveClass('bg-card');
        expect(group).toHaveClass('bg-primary/10');
    });
});
