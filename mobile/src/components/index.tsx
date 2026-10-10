/** Composants d'interface partagés : un seul fichier, ils sont tous courts. */
export { BusinessCardPreview, CARD_RATIO } from './BusinessCardPreview';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { makeStyles, radius, spacing, TOUCH_TARGET, useTheme } from '../theme';

/* --------------------------------- Écran --------------------------------- */

export function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {content}
    </SafeAreaView>
  );
}

/* --------------------------------- Bouton -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: string;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
    secondary: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: colors.border },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.danger },
    success: { bg: colors.success, fg: '#08210F', border: colors.success },
  };
  const tone = palette[variant];
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive) }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tone.bg, borderColor: tone.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={tone.fg} />
      ) : (
        <Text style={[styles.buttonLabel, { color: tone.fg }]} numberOfLines={1}>
          {icon ? `${icon}  ` : ''}
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* --------------------------------- Champ --------------------------------- */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  confidence,
  multiline,
  ...rest
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  confidence?: number;
  multiline?: boolean;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'placeholder'> & { placeholder?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  // Un champ extrait avec peu de certitude est signalé pour que l'utilisateur le relise.
  const uncertain = value.trim() !== '' && confidence !== undefined && confidence < 0.6;

  return (
    <View style={styles.fieldWrap}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        {uncertain ? <Text style={styles.fieldWarn}>à vérifier</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          uncertain && styles.inputUncertain,
        ]}
        {...rest}
      />
    </View>
  );
}

/* -------------------------------- Divers --------------------------------- */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'info';
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toneColor = {
    neutral: colors.textMuted,
    success: colors.success,
    warning: colors.warning,
    info: colors.primary,
  }[tone];
  return (
    <View style={[styles.badge, { borderColor: toneColor }]}>
      <Text style={[styles.badgeText, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: string;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loader({ label }: { label?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={styles.loaderLabel}>{label}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({
  label,
  value,
  onPress,
  icon,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  icon?: string;
}) {
  const styles = useStyles();
  const body = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {icon ? `${icon}  ` : ''}
        {label}
      </Text>
      <Text style={[styles.rowValue, onPress && styles.rowValueLink]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, typography, elevation }) => ({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  button: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },

  fieldWrap: { gap: spacing.xs },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...typography.label },
  fieldWarn: { fontSize: 11, color: colors.warning, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: TOUCH_TARGET,
    color: colors.text,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputUncertain: { borderColor: colors.warning },

  sectionTitle: {
    ...typography.label,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },

  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },

  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm, flex: 1 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { ...typography.h1, textAlign: 'center' },
  emptyMessage: { ...typography.caption, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  emptyAction: { marginTop: spacing.md, alignSelf: 'stretch' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loaderLabel: { ...typography.caption },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...elevation,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
  },
  rowLabel: { ...typography.caption, flexShrink: 0 },
  rowValue: { ...typography.body, flex: 1, textAlign: 'right' },
  rowValueLink: { color: colors.primary },
}));
