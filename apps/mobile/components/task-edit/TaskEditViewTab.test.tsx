import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TaskEditViewTab } from './TaskEditViewTab';

function MockTaskStatusBadge(props: any) {
  return React.createElement('TaskStatusBadge', props);
}

vi.mock('../task-status-badge', () => ({
  TaskStatusBadge: MockTaskStatusBadge,
}));

vi.mock('../markdown-text', () => ({
  MarkdownText: (props: any) => React.createElement('MarkdownText', props),
}));

vi.mock('../AttachmentProgressIndicator', () => ({
  AttachmentProgressIndicator: (props: any) => React.createElement('AttachmentProgressIndicator', props),
}));

describe('TaskEditViewTab', () => {
  it('renders an interactive status badge and forwards updates', () => {
    const onStatusUpdate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <TaskEditViewTab
          t={(key) =>
            ({
              'taskEdit.statusLabel': 'Status',
              'status.next': 'Next',
              'status.done': 'Done',
            }[key] ?? key)
          }
          tc={{
            text: '#fff',
            secondaryText: '#aaa',
            inputBg: '#111',
            border: '#222',
            cardBg: '#000',
            tint: '#3b82f6',
          } as any}
          styles={{
            content: {},
            contentContainer: {},
            viewRow: {},
            viewLabel: {},
            viewValue: {},
            viewSection: {},
            viewPillRow: {},
            viewPill: {},
            viewPillText: {},
            viewCard: {},
            viewChecklist: {},
            viewChecklistItem: {},
            viewChecklistText: {},
            viewAttachmentGrid: {},
            viewAttachmentCard: {},
            viewAttachmentText: {},
            viewAttachmentSubtext: {},
            viewAttachmentImage: {},
          }}
          mergedTask={{
            id: 'task-1',
            title: 'Preview task',
            status: 'next',
            tags: [],
            contexts: [],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
          }}
          projects={[]}
          sections={[]}
          areas={[]}
          prioritiesEnabled={false}
          timeEstimatesEnabled={false}
          formatTimeEstimateLabel={(value) => String(value)}
          formatDate={(value) => value}
          formatDueDate={(value) => value}
          getRecurrenceRuleValue={() => ''}
          getRecurrenceStrategyValue={() => 'strict'}
          applyChecklistUpdate={vi.fn()}
          visibleAttachments={[]}
          openAttachment={vi.fn()}
          isImageAttachment={() => false}
          textDirectionStyle={{}}
          resolvedDirection="ltr"
          onStatusUpdate={onStatusUpdate}
        />
      );
    });

    const badge = tree.root.findByType(MockTaskStatusBadge);
    expect(badge.props.status).toBe('next');

    renderer.act(() => {
      badge.props.onUpdate('done');
    });

    expect(onStatusUpdate).toHaveBeenCalledWith('done');
  });
});
