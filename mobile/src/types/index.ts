/**
 * Modèle de données central de l'application.
 * Une carte scannée (BusinessCard) est la source de vérité locale ; le contact
 * du téléphone en est une projection, créée après validation par l'utilisateur.
 */

/** Champs extraits d'une carte de visite. */
export interface CardFields {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  phone: string;
  secondaryPhone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  city: string;
  country: string;
  linkedin: string;
  notes: string;
}

export const EMPTY_FIELDS: CardFields = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  company: '',
  phone: '',
  secondaryPhone: '',
  whatsapp: '',
  email: '',
  website: '',
  address: '',
  city: '',
  country: '',
  linkedin: '',
  notes: '',
};

export type CardFieldKey = keyof CardFields;

/** Ordre d'affichage et libellés FR de chaque champ dans l'écran de vérification. */
export const FIELD_LABELS: Record<CardFieldKey, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  jobTitle: 'Fonction / Poste',
  company: 'Entreprise',
  phone: 'Téléphone principal',
  secondaryPhone: 'Téléphone secondaire',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  website: 'Site web',
  address: 'Adresse',
  city: 'Ville',
  country: 'Pays',
  linkedin: 'LinkedIn',
  notes: 'Notes',
};

/** Niveau de confiance 0 → 1 par champ, produit par l'OCR + l'extraction. */
export type FieldConfidence = Partial<Record<CardFieldKey, number>>;

export type CardStatus =
  | 'draft' // extraite, pas encore validée par l'utilisateur
  | 'validated' // vérifiée et enregistrée, sans contact créé
  | 'contact_created' // contact présent dans le répertoire du téléphone
  | 'archived';

export type SyncState = 'local' | 'pending' | 'synced' | 'error';

export type CardSource = 'scanner' | 'camera' | 'gallery' | 'manual';

export type OcrEngine = 'mlkit' | 'cloud' | 'manual';

export interface BusinessCard extends CardFields {
  id: string;
  /** Image recto (URI locale, dossier privé de l'app). */
  imageUri: string | null;
  /** Image verso, optionnelle. */
  backImageUri: string | null;
  /** Texte OCR brut, conservé pour ré-extraction sans re-scanner. */
  rawText: string;
  confidence: FieldConfidence;
  status: CardStatus;
  /** Identifiant du contact créé dans le répertoire natif (expo-contacts). */
  contactId: string | null;
  source: CardSource;
  ocrEngine: OcrEngine;
  /** Langues détectées sur la carte (codes ISO 639-1). */
  languages: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncState: SyncState;
  /** Propriétaire côté cloud ; null tant que l'utilisateur n'est pas connecté. */
  ownerId: string | null;
  /** Chemin de l'image dans le bucket Supabase, une fois synchronisée. */
  remoteImagePath: string | null;
}

/** Résultat d'un passage OCR, avant extraction des champs. */
export interface OcrResult {
  text: string;
  engine: OcrEngine;
  /** Lignes ordonnées de haut en bas, avec leur géométrie quand elle est connue. */
  lines: OcrLine[];
  /** Champs déjà structurés quand le moteur sait le faire (extraction IA cloud). */
  fields?: Partial<CardFields>;
  confidence?: FieldConfidence;
  languages?: string[];
}

export interface OcrLine {
  text: string;
  /** Position verticale normalisée (0 = haut de la carte). */
  y?: number;
  /** Hauteur relative du texte : sert à repérer le nom, souvent le plus gros. */
  height?: number;
}

/** Résultat complet du pipeline scan → OCR → extraction. */
export interface ScanOutcome {
  fields: CardFields;
  confidence: FieldConfidence;
  rawText: string;
  engine: OcrEngine;
  languages: string[];
  imageUri: string | null;
}

export type DuplicateMatchReason = 'phone' | 'email' | 'name_company';

export interface DuplicateMatch {
  /** Contact natif du téléphone. */
  contactId: string;
  name: string;
  company?: string;
  reason: DuplicateMatchReason;
  phones: string[];
  emails: string[];
}

export interface AppSettings {
  /** Enregistrer la carte dans le répertoire sans confirmation supplémentaire. */
  autoCreateContact: boolean;
  /** Enchaîner automatiquement sur un nouveau scan après validation. */
  batchMode: boolean;
  /** Autoriser l'extraction IA dans le cloud (sinon, 100 % hors ligne). */
  cloudAiEnabled: boolean;
  /** Synchroniser cartes et images vers le cloud. */
  cloudSyncEnabled: boolean;
  /** Ajouter le texte OCR brut dans les notes du contact. */
  rawTextInNotes: boolean;
  /**
   * Proposer, après la création du contact, de le déposer aussi dans un compte
   * synchronisé (Google, iCloud, Outlook) pour le retrouver sur tout appareil.
   */
  offerSyncedAccount: boolean;
  /** Indicatif pays par défaut, utilisé pour normaliser les numéros locaux. */
  defaultCountryCode: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCreateContact: false,
  batchMode: false,
  cloudAiEnabled: true,
  cloudSyncEnabled: false,
  rawTextInNotes: false,
  offerSyncedAccount: true,
  defaultCountryCode: '+243',
};
