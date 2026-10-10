/**
 * Jetons visuels de l'application, en deux teintes.
 *
 * Les deux palettes portent exactement les mêmes clés : un écran s'écrit une
 * fois et fonctionne dans les deux modes. Les contrastes ont été choisis pour
 * rester lisibles en plein soleil (mode clair) comme le soir (mode sombre) —
 * l'application se consulte aussi bien sur un chantier que dans un bureau.
 */

export type ThemeScheme = 'light' | 'dark';

export interface ThemeColors {
  /** Fond de l'écran. */
  bg: string;
  /** Fond d'une carte posée sur l'écran. */
  surface: string;
  /** Fond d'un élément à l'intérieur d'une carte (champ, vignette). */
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryDark: string;
  /** Teinte translucide de la couleur principale, pour les fonds discrets. */
  primarySoft: string;
  /** Couleur du texte posé sur la couleur principale. */
  onPrimary: string;
  success: string;
  warning: string;
  danger: string;
  /** Voile sombre derrière une caméra ou une modale. */
  overlay: string;
  /** Couleur d'ombre portée, transparente en mode sombre. */
  shadow: string;
  white: string;
}

export const darkColors: ThemeColors = {
  bg: '#0B1020',
  surface: '#141B2D',
  surfaceAlt: '#1C2540',
  border: '#27324F',
  text: '#EEF2FB',
  textMuted: '#93A1C0',
  textFaint: '#66738F',
  primary: '#4C8DFF',
  primaryDark: '#2563EB',
  primarySoft: 'rgba(76,141,255,0.16)',
  onPrimary: '#FFFFFF',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  overlay: 'rgba(5,8,16,0.74)',
  shadow: 'rgba(0,0,0,0.5)',
  white: '#FFFFFF',
};

export const lightColors: ThemeColors = {
  bg: '#F4F7FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF1F8',
  border: '#DCE3EE',
  text: '#101828',
  textMuted: '#57667F',
  textFaint: '#8795AB',
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primarySoft: 'rgba(37,99,235,0.10)',
  onPrimary: '#FFFFFF',
  success: '#15A34A',
  warning: '#D97706',
  danger: '#DC2626',
  overlay: 'rgba(15,23,42,0.55)',
  shadow: 'rgba(16,24,40,0.12)',
  white: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

/** Hauteur minimale des zones tactiles (accessibilité). */
export const TOUCH_TARGET = 48;

export type Typography = ReturnType<typeof makeTypography>;

export function makeTypography(c: ThemeColors) {
  return {
    display: { fontSize: 32, fontWeight: '800' as const, color: c.text, letterSpacing: -0.6 },
    title: { fontSize: 25, fontWeight: '700' as const, color: c.text, letterSpacing: -0.3 },
    h1: { fontSize: 20, fontWeight: '700' as const, color: c.text, letterSpacing: -0.2 },
    h2: { fontSize: 16, fontWeight: '600' as const, color: c.text },
    body: { fontSize: 15, fontWeight: '400' as const, color: c.text },
    label: { fontSize: 12, fontWeight: '600' as const, color: c.textMuted, letterSpacing: 0.5 },
    caption: { fontSize: 12.5, fontWeight: '400' as const, color: c.textMuted },
  };
}

/** Ombre portée : discrète en mode clair, inexistante en mode sombre où elle ne se voit pas. */
export function elevation(c: ThemeColors, scheme: ThemeScheme) {
  if (scheme === 'dark') return {};
  return {
    shadowColor: c.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  };
}
