/**
 * Thème de l'application : palette, typographie et bascule clair / sombre.
 *
 * Les styles ne peuvent pas être figés au chargement du module, puisque la
 * teinte change en cours d'exécution. `makeStyles` les construit donc une fois
 * par thème et les garde en cache : le coût est nul au rendu, et un écran
 * s'écrit presque comme avec un `StyleSheet.create` ordinaire.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { useSettingsStore } from '../store/settingsStore';
import {
  darkColors,
  elevation,
  lightColors,
  makeTypography,
  type ThemeColors,
  type ThemeScheme,
  type Typography,
} from './tokens';

export * from './tokens';

export interface Theme {
  scheme: ThemeScheme;
  colors: ThemeColors;
  typography: Typography;
  /** Ombre portée adaptée à la teinte courante. */
  elevation: ViewStyle;
}

/** Les deux thèmes sont construits une seule fois : leur identité sert de clé de cache. */
const THEMES: Record<ThemeScheme, Theme> = {
  dark: {
    scheme: 'dark',
    colors: darkColors,
    typography: makeTypography(darkColors),
    elevation: elevation(darkColors, 'dark'),
  },
  light: {
    scheme: 'light',
    colors: lightColors,
    typography: makeTypography(lightColors),
    elevation: elevation(lightColors, 'light'),
  },
};

const ThemeContext = createContext<Theme>(THEMES.dark);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.settings.themeMode);
  const system = useColorScheme();
  const scheme: ThemeScheme =
    themeMode === 'system' ? (system === 'light' ? 'light' : 'dark') : themeMode;

  const theme = useMemo(() => THEMES[scheme], [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Déclare une feuille de styles dépendante du thème.
 *
 * ```ts
 * const useStyles = makeStyles(({ colors }) => StyleSheet.create({ box: { backgroundColor: colors.bg } }));
 * // dans le composant : const styles = useStyles();
 * ```
 */
export function makeStyles<T extends Styles>(factory: (theme: Theme) => T): () => T {
  const cache = new Map<ThemeScheme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let sheet = cache.get(theme.scheme);
    if (!sheet) {
      sheet = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, sheet);
    }
    return sheet;
  };
}
