import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AttachmentProgress, globalProgressTracker } from '@mindwtr/core';
import { useThemeColors } from '@/hooks/use-theme-colors';

type AttachmentProgressIndicatorProps = {
  attachmentId: string;
};

export function AttachmentProgressIndicator({ attachmentId }: AttachmentProgressIndicatorProps) {
  const tc = useThemeColors();
  const [progress, setProgress] = useState<AttachmentProgress | null>(null);

  useEffect(() => {
    return globalProgressTracker.subscribe(attachmentId, (next) => {
      setProgress(next);
    });
  }, [attachmentId]);

  if (!progress || progress.status === 'completed' || progress.status === 'failed') return null;

  const total = progress.totalBytes;
  const percentage = total > 0 ? Math.min(100, Math.round((progress.bytesTransferred / total) * 100)) : null;

  return (
    <View style={styles.container}>
      <View style={[styles.track, { backgroundColor: tc.border }]}>
        {percentage !== null ? (
          <View style={[styles.fill, { width: `${percentage}%`, backgroundColor: tc.tint }]} />
        ) : null}
      </View>
      <Text style={[styles.label, { color: tc.secondaryText }]}>
        {percentage !== null ? `${percentage}%` : '...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  label: {
    marginTop: 4,
    fontSize: 11,
  },
});
