import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, fontSize, radius, shadows, spacing } from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export default function Card({ title, subtitle, children }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    ...shadows.card,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.semibold,
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
});
