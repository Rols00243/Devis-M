/** Pile de navigation unique : l'application est linéaire, sans onglets. */
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import AccountScreen from '../screens/AccountScreen';
import CardDetailScreen from '../screens/CardDetailScreen';
import CardsScreen from '../screens/CardsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import HomeScreen from '../screens/HomeScreen';
import ReviewScreen from '../screens/ReviewScreen';
import ScanScreen from '../screens/ScanScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 16, fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ title: 'Scanner une carte', headerTransparent: true, headerTintColor: '#FFF' }}
        />
        <Stack.Screen
          name="Review"
          component={ReviewScreen}
          options={{ title: 'Vérifier les informations', headerBackTitle: 'Retour' }}
        />
        <Stack.Screen name="Cards" component={CardsScreen} options={{ title: 'Mes cartes' }} />
        <Stack.Screen name="CardDetail" component={CardDetailScreen} options={{ title: 'Fiche' }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Historique' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Paramètres' }} />
        <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Compte' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
