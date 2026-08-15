import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  useTheme,
  type ThemeColors,
  type ThemeShadows,
  fonts,
  fontSize,
  radius,
  spacing,
} from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export default function Card({ title, subtitle, children }: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadows), [colors, shadows]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function makeStyles(c: ThemeColors, s: ThemeShadows) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      padding: spacing.md,
      ...s.card,
    },
    title: {
      fontFamily: fonts.bold,
      fontSize: fontSize.md,
      color: c.text,
    },
    subtitle: {
      fontFamily: fonts.semibold,
      fontSize: fontSize.sm,
      color: c.muted,
      marginTop: spacing.xs,
    },
  });
}