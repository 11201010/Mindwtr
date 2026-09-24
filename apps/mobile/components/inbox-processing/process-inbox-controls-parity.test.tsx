import React from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { describe, expect, it, vi } from 'vitest';
import { InboxCaptureCard } from './InboxCaptureCard';
import { InboxDatePickers } from './InboxDatePickers';

vi.mock('./SimilarTasksHint', () => ({ SimilarTasksHint: () => null }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: 'DateTimePicker' }));

const fixturePath = new URL('../../../../packages/core/src/process-inbox-model-controls.fixtures.json', import.meta.url).pathname;
const capture = process.env.MINDWTR_CAPTURE_INBOX_CONTROLS === '1';
const descriptions = ['', '   \n  ', '# Heading\n**Bold** and _italic_ [link](https://example.com)\n> Quote\n- Item\n`code`', '**' + 'A'.repeat(199) + '😀tail**', '![alt](image.png)\n~~gone~~\n```js\nconst x = 1;\n```'];
const days = ['2026-03-08', '2026-11-01', '2028-02-29', '2026-12-31'];

const props: Parameters<typeof InboxCaptureCard>[0] = {
  t: (key) => key,
  tc: {} as Parameters<typeof InboxCaptureCard>[0]['tc'],
  titleInputRef: { current: null! },
  processingTitle: 'Capture', setProcessingTitle: vi.fn(),
  similarTasks: [], similarTaskProjectTitles: new Map(), convertToProject: false,
  processingDescription: '', setProcessingDescription: vi.fn(),
  processingTitleFocused: false, setProcessingTitleFocused: vi.fn(), titleDirectionStyle: {},
  aiEnabled: false, isAIWorking: false, isAICancellable: false,
  handleAIClarifyInbox: vi.fn(), handleAICancelInbox: vi.fn(), aiWorkingText: '',
  notesOpen: false, setNotesOpen: vi.fn(), isReturningItem: false,
};

describe('frozen RN capture-card and picked-date behavior', () => {
  it('keeps the exact preview bytes and local picker normalization', async () => {
    const notes = [];
    for (const description of descriptions) {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => { tree = renderer.create(<InboxCaptureCard {...props} processingDescription={description} />); });
      const preview = tree.root.findAllByType(Text).find((node) => node.props.numberOfLines === 2)?.props.children ?? '';
      notes.push({ description, preview });
      await act(async () => tree.unmount());
    }
    const dates = [];
    const oldTz = process.env.TZ;
    try {
      for (const timeZone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = timeZone;
        for (const day of days) {
          const [year, month, date] = day.split('-').map(Number);
          const input = new Date(year, month - 1, date, 23, 47, 31, 123);
          const onSelect = vi.fn();
          const onClose = vi.fn();
          let tree!: renderer.ReactTestRenderer;
          await act(async () => { tree = renderer.create(<InboxDatePickers configs={[{ show: true, value: null, onSelect, onClose }]} />); });
          const picker = tree.root.findByType(DateTimePicker);
          await act(async () => picker.props.onChange({ type: 'dismissed' }, input));
          expect(onSelect).not.toHaveBeenCalled();
          await act(async () => picker.props.onChange({ type: 'set' }, input));
          dates.push({ timeZone, day, input: input.toISOString(), picked: (onSelect.mock.calls[0][0] as Date).toISOString() });
          await act(async () => tree.unmount());
        }
      }
    } finally {
      if (oldTz === undefined) delete process.env.TZ;
      else process.env.TZ = oldTz;
    }
    const observed = { notes, dates };
    if (capture) writeFileSync(fixturePath, JSON.stringify({
      provenance: { commit: '5f44e2d1aae8cfa0fe8f9c0107dd2aa020034fc3', source: 'Unmodified RN InboxCaptureCard and InboxDatePickers rendered in a temporary HEAD checkout before extraction.' },
      ...observed,
    }, null, 2) + '\n');
    const frozen = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(observed).toEqual({ notes: frozen.notes, dates: frozen.dates });
  });
});
