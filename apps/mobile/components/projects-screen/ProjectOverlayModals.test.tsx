import React from 'react';
import renderer from 'react-test-renderer';
import { AccessibilityInfo, Alert, Platform, ScrollView, TextInput } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectImagePreviewModal, ProjectLinkModal } from './ProjectOverlayModals';

const sharingMocks = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-sharing', () => sharingMocks);

beforeEach(() => {
  sharingMocks.isAvailableAsync.mockReset().mockResolvedValue(true);
  sharingMocks.shareAsync.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

it('bounds a long project link paste and announces a new invalid line on iOS', () => {
  const originalOS = Platform.OS;
  Object.assign(Platform, { OS: 'ios' });
  const announce = vi.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const props = {
    visible: true,
    presentationStyle: 'overFullScreen' as const,
    t: (key: string) => key === 'attachments.invalidLinkLine' ? 'Line {{line}} invalid' : key,
    tc: { cardBg: '#111', border: '#222', text: '#fff', secondaryText: '#aaa', inputBg: '#000', filterBg: '#000', tint: '#3b82f6' },
    linkInput: 'https://one.example\ninvalid',
    onChangeLinkInput: vi.fn(),
    onClose: vi.fn(),
    onSave: vi.fn(),
  };
  let tree: renderer.ReactTestRenderer | undefined;
  try {
    renderer.act(() => { tree = renderer.create(<ProjectLinkModal {...props} />); });
    expect(tree!.root.findByType(TextInput).props.style).toEqual(expect.arrayContaining([expect.objectContaining({ height: 120 })]));
    expect(tree!.root.findByType(ScrollView).props.style).toEqual({ flexShrink: 1 });
    expect(tree!.root.findByType(ScrollView).parent?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ maxHeight: '100%' })]));
    expect(tree!.root.findByType(ScrollView).findAllByProps({ children: 'common.save' })).toHaveLength(0);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Line 2 invalid');
    renderer.act(() => { tree!.update(<ProjectLinkModal {...props} linkInput={'https://one.example\nstill invalid'} />); });
    expect(announce).toHaveBeenCalledTimes(1);
  } finally {
    if (tree) renderer.act(() => tree!.unmount());
    Object.assign(Platform, { OS: originalOS });
  }
});

describe('ProjectImagePreviewModal', () => {
  it('tells the user when image sharing fails', async () => {
    sharingMocks.shareAsync.mockRejectedValue(new Error('share rejected'));
    const alertSpy = vi.spyOn(Alert, 'alert');

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <ProjectImagePreviewModal
          visible
          presentationStyle="overFullScreen"
          t={(key) => ({
            'attachments.title': 'Attachments',
            'common.close': 'Close',
            'common.share': 'Share',
            'share.unavailable': 'Share unavailable',
          }[key] ?? key)}
          tc={{
            cardBg: '#111',
            border: '#222',
            text: '#fff',
            secondaryText: '#aaa',
            inputBg: '#000',
            filterBg: '#000',
            tint: '#3b82f6',
          }}
          attachment={{
            id: 'image-1',
            kind: 'file',
            title: 'Photo',
            uri: 'file:///photo.jpg',
            mimeType: 'image/jpeg',
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:00:00.000Z',
          }}
          onClose={vi.fn()}
        />,
      );
    });

    const shareButton = tree.root.findByProps({ children: 'Share' }).parent;
    if (!shareButton || typeof shareButton.props.onPress !== 'function') {
      throw new Error('Share button not found');
    }
    await renderer.act(async () => {
      shareButton.props.onPress();
    });

    expect(sharingMocks.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Attachments', 'Share unavailable');
  });
});
