import React from 'react';
import { Pressable, View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import type { ThemeColors } from '@/hooks/use-theme-colors';
import {
  createMarkdownLinkLookup,
  parseMarkdownBlocks,
  resolveMarkdownInline,
  shallow,
  tFallback,
  useTaskStore,
  type MarkdownLinkLookup,
} from '@mindwtr/core';
import { useLanguage } from '@/contexts/language-context';
import { openProjectScreen, openTaskScreen } from '@/lib/task-meta-navigation';
import { openExternalLink } from '@/lib/open-external-link';

const INLINE_CODE_EDGE_SPACE = '\u2006';

const writeClipboardText = (text: string) => {
  void Clipboard.setStringAsync(text).catch(() => undefined);
};

type MarkdownRenderOptions = {
  lookup: MarkdownLinkLookup;
  deletedTaskLabel: string;
  deletedProjectLabel: string;
  copyCodeLabel: string;
  openExternalLink: (href: string) => void;
};

function useMarkdownRenderOptions(): MarkdownRenderOptions {
  const { t } = useLanguage();
  const { tasks, projects } = useTaskStore((state) => ({
    tasks: state._allTasks,
    projects: state._allProjects,
  }), shallow);
  const lookup = React.useMemo(
    () => createMarkdownLinkLookup(tasks, projects),
    [tasks, projects],
  );
  const deletedTaskLabel = tFallback(t, 'markdown.referenceDeletedTask', 'deleted task');
  const deletedProjectLabel = tFallback(t, 'markdown.referenceDeletedProject', 'deleted project');
  const copyCodeLabel = tFallback(t, 'markdown.copyCode', 'Copy code');
  const openLink = React.useCallback((href: string) => {
    void openExternalLink(href, t, 'markdown');
  }, [t]);
  return {
    lookup,
    deletedTaskLabel,
    deletedProjectLabel,
    copyCodeLabel,
    openExternalLink: openLink,
  };
}

function renderInline(
  text: string,
  tc: ThemeColors,
  keyPrefix: string,
  options: MarkdownRenderOptions,
): React.ReactNode[] {
  return resolveMarkdownInline(text, options.lookup).map((node, index) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'code') {
      const paddedText = node.text ? `${INLINE_CODE_EDGE_SPACE}${node.text}${INLINE_CODE_EDGE_SPACE}` : node.text;
      return (
        <Text
          key={`${keyPrefix}-code-${index}`}
          testID="markdown-inline-code"
          style={[styles.code, { backgroundColor: tc.cardBg, color: tc.text }]}
        >
          {paddedText}
        </Text>
      );
    }
    if (node.type === 'bold') {
      return (
        <Text key={`${keyPrefix}-bold-${index}`} style={styles.bold}>
          {node.text}
        </Text>
      );
    }
    if (node.type === 'italic') {
      return (
        <Text key={`${keyPrefix}-italic-${index}`} style={styles.italic}>
          {node.text}
        </Text>
      );
    }
    if (node.type === 'strike') {
      return (
        <Text key={`${keyPrefix}-strike-${index}`} style={styles.struckText}>
          {node.text}
        </Text>
      );
    }
    if (node.type === 'deletedReference') {
      return (
        <Text key={`${keyPrefix}-deleted-${node.entityType}-${index}`} style={[styles.deletedLink, { color: tc.secondaryText }]}>
          <Text style={styles.struckText}>{node.text}</Text>
          <Text>{` (${node.entityType === 'project' ? options.deletedProjectLabel : options.deletedTaskLabel})`}</Text>
        </Text>
      );
    }
    const { target } = node;
    const onPress = target.kind === 'project'
      ? () => openProjectScreen(target.id)
      : target.kind === 'task'
        ? () => openTaskScreen(target.id, target.projectId ?? undefined)
        : () => options.openExternalLink(target.href);
    return (
      <Text
        key={`${keyPrefix}-${target.kind === 'external' ? 'link' : target.kind}-${index}`}
        style={[styles.link, { color: tc.tint }]}
        onPress={onPress}
      >
        {node.text}
      </Text>
    );
  });
}

export function MarkdownInlineText({
  markdown,
  tc,
  direction,
  style,
  numberOfLines,
}: {
  markdown: string;
  tc: ThemeColors;
  direction?: 'ltr' | 'rtl';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const renderOptions = useMarkdownRenderOptions();
  const directionStyle: TextStyle | undefined = direction
    ? { writingDirection: direction, textAlign: direction === 'rtl' ? 'right' : 'left' }
    : undefined;

  return (
    <Text style={[style, directionStyle]} numberOfLines={numberOfLines}>
      {renderInline(markdown || '', tc, 'inline', renderOptions)}
    </Text>
  );
}

export function MarkdownText({
  markdown,
  tc,
  direction,
  selectable = false,
}: {
  markdown: string;
  tc: ThemeColors;
  direction?: 'ltr' | 'rtl';
  selectable?: boolean;
}) {
  const renderOptions = useMarkdownRenderOptions();
  const directionStyle: TextStyle | undefined = direction
    ? { writingDirection: direction, textAlign: direction === 'rtl' ? 'right' : 'left' }
    : undefined;
  const { copyCodeLabel } = renderOptions;

  const blocks = parseMarkdownBlocks(markdown || '').map((block) => {
    switch (block.type) {
      case 'blank':
        return (
          <View
            key={`blank-${block.start}`}
            testID="markdown-blank-line"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.blankLine}
          />
        );
      case 'heading':
        return (
          <Text
            key={`h-${block.start}`}
            selectable={selectable}
            style={[
              styles.heading,
              { color: tc.text, fontSize: block.level === 1 ? 16 : block.level === 2 ? 15 : 14 },
              directionStyle,
            ]}
          >
            {renderInline(block.text, tc, `h-${block.start}`, renderOptions)}
          </Text>
        );
      case 'rule':
        return <View key={`hr-${block.start}`} style={[styles.separator, { backgroundColor: tc.border }]} />;
      case 'code':
        return (
          <View
            key={`code-${block.start}`}
            style={[styles.codeBlock, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copyCodeLabel}
              hitSlop={8}
              onPress={() => writeClipboardText(block.text)}
              style={({ pressed }) => [
                styles.codeCopyButton,
                {
                  backgroundColor: pressed ? tc.border : tc.filterBg,
                  borderColor: tc.border,
                },
              ]}
            >
              <Ionicons name="copy-outline" size={15} color={tc.secondaryText} />
            </Pressable>
            <Text selectable={selectable} style={[styles.codeBlockText, { color: tc.text }, directionStyle]}>
              {block.text}
            </Text>
          </View>
        );
      case 'taskList':
        return (
          <View key={`task-ul-${block.start}`} style={styles.list}>
            {block.items.map((item, idx) => (
              <View key={idx} testID="markdown-list-item" style={[styles.listRow, { marginLeft: item.depth * 14 }]}>
                <Text style={[styles.taskListMarker, { color: tc.secondaryText }]}>
                  {item.checked ? '☑' : '☐'}
                </Text>
                <Text selectable={selectable} style={[styles.paragraph, styles.taskListText, { color: tc.text }, directionStyle]}>
                  {renderInline(item.text, tc, `task-li-${block.start}-${idx}`, renderOptions)}
                </Text>
              </View>
            ))}
          </View>
        );
      case 'bulletList':
      case 'orderedList': {
        const ordered = block.type === 'orderedList';
        return (
          <View key={`${ordered ? 'ol' : 'ul'}-${block.start}`} style={styles.list}>
            {block.items.map((item, idx) => (
              <View key={idx} testID="markdown-list-item" style={[styles.listRow, { marginLeft: item.depth * 14 }]}>
                <Text style={[ordered ? styles.orderedListMarker : styles.listMarker, { color: tc.secondaryText }]}>
                  {item.marker}
                </Text>
                <Text selectable={selectable} style={[styles.paragraph, styles.listItemText, { color: tc.text }, directionStyle]}>
                  {renderInline(item.text, tc, `${ordered ? 'oli' : 'li'}-${block.start}-${idx}`, renderOptions)}
                </Text>
              </View>
            ))}
          </View>
        );
      }
      case 'paragraph':
        return (
          <Text key={`p-${block.end}`} selectable={selectable} style={[styles.paragraph, { color: tc.text }, directionStyle]}>
            {renderInline(block.text, tc, `p-${block.end}`, renderOptions)}
          </Text>
        );
      default:
        return null;
    }
  });

  return <View style={styles.container}>{blocks}</View>;
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 18,
  },
  blankLine: {
    height: 12,
  },
  heading: {
    fontWeight: '700',
    lineHeight: 20,
  },
  list: {
    gap: 4,
    paddingLeft: 6,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  listMarker: {
    fontSize: 13,
    lineHeight: 18,
    width: 14,
  },
  orderedListMarker: {
    fontSize: 13,
    lineHeight: 18,
    minWidth: 22,
  },
  taskListMarker: {
    fontSize: 13,
    lineHeight: 18,
    width: 14,
  },
  listItemText: {
    flexShrink: 1,
  },
  taskListText: {
    flexShrink: 1,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
    paddingHorizontal: 4,
    paddingVertical: 0,
    borderRadius: 4,
  },
  codeBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    paddingRight: 38,
  },
  codeCopyButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 1,
    width: 28,
    height: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  link: {
    textDecorationLine: 'underline',
  },
  deletedLink: {
    textDecorationLine: 'none',
  },
  struckText: {
    textDecorationLine: 'line-through',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
