import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';

import type { ThemeColors } from '@/hooks/use-theme-colors';

function isSafeLink(href: string): boolean {
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

function renderInline(text: string, tc: ThemeColors, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRe = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const boldA = match[2];
    const boldB = match[3];
    const italicA = match[4];
    const italicB = match[5];
    const code = match[6];
    const linkText = match[7];
    const linkHref = match[8];

    if (code) {
      nodes.push(
        <Text key={`${keyPrefix}-code-${match.index}`} style={[styles.code, { backgroundColor: tc.filterBg, color: tc.text }]}>
          {code}
        </Text>
      );
    } else if (boldA || boldB) {
      nodes.push(
        <Text key={`${keyPrefix}-bold-${match.index}`} style={styles.bold}>
          {boldA || boldB}
        </Text>
      );
    } else if (italicA || italicB) {
      nodes.push(
        <Text key={`${keyPrefix}-italic-${match.index}`} style={styles.italic}>
          {italicA || italicB}
        </Text>
      );
    } else if (linkText && linkHref) {
      if (isSafeLink(linkHref)) {
        nodes.push(
          <Text
            key={`${keyPrefix}-link-${match.index}`}
            style={[styles.link, { color: tc.tint }]}
            onPress={() => Linking.openURL(linkHref)}
          >
            {linkText}
          </Text>
        );
      } else {
        nodes.push(linkText);
      }
    }

    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function MarkdownText({ markdown, tc }: { markdown: string; tc: ThemeColors }) {
  const source = (markdown || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');

  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push(
        <Text
          key={`h-${i}`}
          style={[
            styles.heading,
            { color: tc.text, fontSize: level === 1 ? 16 : level === 2 ? 15 : 14 }
          ]}
        >
          {renderInline(text, tc, `h-${i}`)}
        </Text>
      );
      i += 1;
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(line);
    if (listMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^[-*]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push(
        <View key={`ul-${i}`} style={styles.list}>
          {items.map((item, idx) => (
            <Text key={idx} style={[styles.paragraph, { color: tc.text }]}>
              • {renderInline(item, tc, `li-${i}-${idx}`)}
            </Text>
          ))}
        </View>
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const text = paragraph.join(' ').trim();
    if (text) {
      blocks.push(
        <Text key={`p-${i}`} style={[styles.paragraph, { color: tc.text }]}>
          {renderInline(text, tc, `p-${i}`)}
        </Text>
      );
    }
  }

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
  heading: {
    fontWeight: '700',
    lineHeight: 20,
  },
  list: {
    gap: 4,
    paddingLeft: 6,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  code: {
    fontFamily: 'monospace',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  link: {
    textDecorationLine: 'underline',
  },
});

