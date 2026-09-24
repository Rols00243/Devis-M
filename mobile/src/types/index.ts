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

/**
 * Nature d'une information supplémentaire lue sur la carte. Elle décide de
 * l'endroit où l'information est écrite dans le contact du téléphone : un
 * numéro va dans les numéros, un e-mail dans les e-mails, le reste en notes.
 */
export type ExtraKind = 'phone' | 'email' | 'website' | 'social' | 'id' | 'address' | 'text';

/**
 * Information présente sur la carte mais qui n'entre dans aucun des 14 champs :
 * troisième numéro, deuxième e-mail, fax, RCCM, page Facebook, slogan, agence…
 *
 * Une carte peut porter n'importe quoi ; le formulaire, lui, a un nombre fixe
 * de cases. Ces « extras » existent pour que rien de ce qui a été lu ne soit
 * jeté : tout est montré à la vérification, puis écrit dans le contact.
 */
export interface ExtraItem {
  /** Libellé affiché et repris dans le contact (« Fax », « RCCM », « Autre e-mail »). */
  label: string;
  value: string;
  kind: ExtraKind;
}

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
  /** Tout ce que la carte porte en plus des 14 champs ; jamais perdu. */
  extras: ExtraItem[];
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
  /** Informations lues au-delà des 14 champs, quand le moteur sait les rendre. */
  extras?: ExtraItem[];
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
  /** Informations lues sur la carte au-delà des 14 champs. */
  extras: ExtraItem[];
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
  /** Teinte de l'interface : celle du téléphone, ou imposée. */
  themeMode: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCreateContact: false,
  batchMode: false,
  cloudAiEnabled: true,
  cloudSyncEnabled: false,
  rawTextInNotes: false,
  offerSyncedAccount: true,
  defaultCountryCode: '+243',
  themeMode: 'system',
};

/* ------------------------------------------------------------------ */
/* Ma carte de visite                                                  */
/* ------------------------------------------------------------------ */

/** Mise en page de la carte que l'utilisateur crée pour lui-même. */
export type CardTemplate = 'classic' | 'bold' | 'minimal';

export const CARD_TEMPLATES: { id: CardTemplate; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classique', hint: 'Bandeau coloré, texte à gauche' },
  { id: 'bold', label: 'Affirmé', hint: 'Fond coloré plein, contraste fort' },
  { id: 'minimal', label: 'Épuré', hint: 'Fond clair, filet de couleur' },
];

/** Couleurs d'accent proposées ; l'utilisateur en choisit une. */
export const CARD_ACCENTS = [
  '#2563EB',
  '#0F766E',
  '#B45309',
  '#B91C1C',
  '#6D28D9',
  '#0F172A',
] as const;

/**
 * La carte de visite de l'utilisateur.
 *
 * Elle reprend les 14 champs d'une carte scannée — c'est le même objet métier,
 * vu de l'autre côté — et y ajoute ce qui relève de la mise en page.
 */
export interface MyCard extends CardFields {
  /** Accroche imprimée sous l'entreprise, facultative. */
  slogan: string;
  /** Logo ou photo, stocké dans le dossier privé de l'application. */
  logoUri: string | null;
  template: CardTemplate;
  accent: string;
  /**
   * Imprimer un QR code contenant la fiche complète. Scanné par n'importe quel
   * téléphone, il transmet le contact sans aucune erreur de lecture.
   */
  showQrCode: boolean;
  updatedAt: string;
}

export const EMPTY_MY_CARD: MyCard = {
  ...EMPTY_FIELDS,
  slogan: '',
  logoUri: null,
  template: 'classic',
  accent: CARD_ACCENTS[0],
  showQrCode: true,
  updatedAt: '',
};
