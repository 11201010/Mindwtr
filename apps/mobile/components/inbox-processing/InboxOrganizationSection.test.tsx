import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { loadTranslations } from '@mindwtr/core';
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_THEME_COLORS } from '@/hooks/use-theme-colors';
import { InboxOrganizationSection } from './InboxOrganizationSection';

describe('InboxOrganizationSection', () => {
  it('renders a German time-estimate chip', async () => {
    const german = await loadTranslations('de');
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<InboxOrganizationSection
        t={(key) => german[key] ?? key}
        tc={FALLBACK_THEME_COLORS}
        show showPriorityField={false} selectedPriority={undefined} setSelectedPriority={vi.fn()}
        showEnergyLevelField={false} selectedEnergyLevel={undefined} setSelectedEnergyLevel={vi.fn()}
        showTimeEstimateField selectedTimeEstimate={undefined} setSelectedTimeEstimate={vi.fn()}
        showAssignedToField={false} selectedAssignedTo="" setSelectedAssignedTo={vi.fn()}
        assignedToSuggestions={[]} PRIORITY_OPTIONS={[]} ENERGY_LEVEL_OPTIONS={[]}
        timeEstimateOptions={['5min']}
      />);
    });
    expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toContain('5 Min.');
  });
});
