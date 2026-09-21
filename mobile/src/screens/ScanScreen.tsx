/**
 * Écran de capture.
 *
 * Deux chemins, dans cet ordre de préférence :
 *  1. le scanner de document du système (contours détectés, capture déclenchée
 *     automatiquement, perspective redressée) — le meilleur résultat ;
 *  2. l'aperçu caméra intégré, avec cadre de visée et capture automatique dès
 *     que le téléphone est stable — le repli quand le module natif est absent.
 *
 * Dans les deux cas, l'image part ensuite dans le même pipeline OCR + IA.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { DeviceMotion } from 'expo-sensors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton, Loader, Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { scanCard, type ScanStage } from '../ocr';
import { isDocumentScannerAvailable, scanDocument } from '../ocr/documentScanner';
import { persistImage } from '../storage/images';
import { prepareForArchive } from '../ocr/imagePipeline';
import { useSettingsStore } from '../store/settingsStore';
import { colors, radius, spacing, typography } from '../theme';
import { errorMessage, log } from '../utils';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

/** Seuil de stabilité (rad/s) sous lequel on considère le téléphone immobile. */
const STEADY_THRESHOLD = 0.12;
/** Durée d'immobilité requise avant le déclenchement automatique. */
const STEADY_MS = 900;

const STAGE_LABEL: Record<ScanStage, string> = {
  preparing: "Préparation de l'image…",
  recognizing: 'Lecture de la carte…',
  analyzing: 'Identification des informations…',
  cloud: 'Analyse IA en cours…',
  done: 'Terminé',
};

export default function ScanScreen({ navigation, route }: Props) {
  const batchMode = route.params?.mode === 'batch';
  const { settings } = useSettingsStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ScanStage>('preparing');
  const [autoCapture, setAutoCapture] = useState(true);
  const [steady, setSteady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steadySince = useRef<number | null>(null);
  const hasShot = useRef(false);

  /* ----------------------- Traitement d'une image ----------------------- */

  const processImage = useCallback(
    async (uri: string) => {
      setBusy(true);
      setError(null);
      try {
        setStage('preparing');
        // On archive une version allégée : la photo brute de 4 Mo n'apporte rien.
        const archive = await prepareForArchive(uri);
        const storedUri = await persistImage(archive.uri);

        const report = await scanCard({
          imageUri: uri,
          cloudAiEnabled: settings.cloudAiEnabled,
          defaultCountryCode: settings.defaultCountryCode,
          onStage: setStage,
        });

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.replace('Review', {
          payload: {
            fields: report.fields,
            confidence: report.confidence,
            rawText: report.rawText,
            engine: report.engine,
            languages: report.languages,
            imageUri: storedUri,
            warning: report.warning,
          },
        });
      } catch (e) {
        log.error('Scan', e);
        setError(errorMessage(e));
        hasShot.current = false;
      } finally {
        setBusy(false);
      }
    },
    [navigation, settings.cloudAiEnabled, settings.defaultCountryCode],
  );

  /* -------------------------- Scanner natif ---------------------------- */

  const openNativeScanner = useCallback(async () => {
    try {
      const result = await scanDocument(1);
      if (result.cancelled || !result.images.length) return;
      await processImage(result.images[0]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [processImage]);

  // Le scanner système est proposé d'emblée : c'est le parcours le plus court.
  useEffect(() => {
    if (isDocumentScannerAvailable() && !hasShot.current) {
      hasShot.current = true;
      openNativeScanner().finally(() => {
        hasShot.current = false;
      });
    }
  }, [openNativeScanner]);

  /* ------------------------ Capture automatique ------------------------ */

  useEffect(() => {
    if (!autoCapture || busy || isDocumentScannerAvailable()) return;

    DeviceMotion.setUpdateInterval(200);
    const subscription = DeviceMotion.addListener(({ rotationRate }) => {
      const motion = rotationRate
        ? Math.abs(rotationRate.alpha) + Math.abs(rotationRate.beta) + Math.abs(rotationRate.gamma)
        : 0;
      const isSteady = motion < STEADY_THRESHOLD;
      setSteady(isSteady);

      if (!isSteady) {
        steadySince.current = null;
        return;
      }
      if (steadySince.current === null) {
        steadySince.current = Date.now();
        return;
      }
      if (Date.now() - steadySince.current > STEADY_MS && !hasShot.current) {
        hasShot.current = true;
        capture();
      }
    });

    return () => subscription.remove();
    // `capture` est stable : il ne dépend que de refs et de `processImage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture, busy, processImage]);

  const capture = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) await processImage(photo.uri);
    } catch (e) {
      hasShot.current = false;
      setError(errorMessage(e));
    }
  }, [busy, processImage]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]?.uri) await processImage(result.assets[0].uri);
  }, [processImage]);

  /* ------------------------------ Rendu ------------------------------- */

  if (busy) {
    return (
      <Screen>
        <Loader label={STAGE_LABEL[stage]} />
        <Text style={styles.busyHint}>
          {stage === 'cloud'
            ? "L'IA relit la carte pour compléter les champs manquants."
            : 'Traitement sur l’appareil, sans connexion nécessaire.'}
        </Text>
      </Screen>
    );
  }

  if (!permission) return <Screen><Loader label="Initialisation de la caméra…" /></Screen>;

  if (!permission.granted) {
    return (
      <Screen scroll>
        <Text style={styles.permTitle}>Accès à la caméra</Text>
        <Text style={styles.permText}>
          L'application a besoin de la caméra pour photographier les cartes de visite. Les images
          restent sur votre téléphone tant que vous n'activez pas la sauvegarde en ligne.
        </Text>
        <AppButton label="Autoriser la caméra" icon="📷" onPress={requestPermission} />
        <AppButton
          label="Choisir une photo existante"
          icon="🖼"
          variant="secondary"
          onPress={pickFromGallery}
        />
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Text style={styles.topHint}>
            {batchMode ? 'Mode multi-cartes' : 'Placez la carte dans le cadre'}
          </Text>
        </View>

        {/* Cadre de visée au format d'une carte de visite (85 × 55 mm). */}
        <View style={[styles.frame, steady && styles.frameSteady]}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        <Text style={styles.steadyHint}>
          {autoCapture
            ? steady
              ? '📸 Capture automatique…'
              : 'Tenez le téléphone immobile'
            : 'Appuyez pour photographier'}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Importer depuis la galerie"
            onPress={pickFromGallery}
            style={styles.sideButton}>
            <Text style={styles.sideIcon}>🖼</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prendre la photo"
            onPress={capture}
            style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}>
            <View style={styles.shutterInner} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              autoCapture ? 'Désactiver la capture automatique' : 'Activer la capture automatique'
            }
            onPress={() => setAutoCapture((v) => !v)}
            style={styles.sideButton}>
            <Text style={styles.sideIcon}>{autoCapture ? '🅰️' : '✋'}</Text>
          </Pressable>
        </View>

        {isDocumentScannerAvailable() ? (
          <Pressable onPress={openNativeScanner} style={styles.scannerLink}>
            <Text style={styles.scannerLinkText}>⬚ Scanner avec détection des bords</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', paddingVertical: spacing.xxl },

  topBar: { alignItems: 'center', paddingTop: spacing.xl },
  topHint: {
    color: colors.white,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    fontSize: 13,
  },

  frame: {
    alignSelf: 'center',
    width: '88%',
    aspectRatio: 85 / 55,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  frameSteady: { borderColor: colors.success },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.white },
  cornerTL: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.md },
  cornerTR: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.md },
  cornerBL: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.md },
  cornerBR: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.md },

  steadyHint: { color: colors.white, textAlign: 'center', fontSize: 13 },
  error: {
    color: colors.white,
    backgroundColor: colors.danger,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    fontSize: 13,
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.xl,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideIcon: { fontSize: 22 },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { opacity: 0.7 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.white },

  scannerLink: { alignSelf: 'center' },
  scannerLinkText: { color: colors.white, fontSize: 13, textDecorationLine: 'underline' },

  busyHint: { ...typography.caption, textAlign: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  permTitle: { ...typography.h1 },
  permText: { ...typography.caption, lineHeight: 21, marginBottom: spacing.md },
});
