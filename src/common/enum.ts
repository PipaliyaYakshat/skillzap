// User related enums
export const USER_ROLE = ['admin', 'userLogin'] as const;
export const USER_TYPE = [
  'individual',
  'superAdmin',
  'admin',
  'member',
] as const;
export const STATUS_UPDATE = ['pending', 'approve', 'reject', 'approved'] as const;

export type UserRole = (typeof USER_ROLE)[number];
export type UserType = (typeof USER_TYPE)[number];
export type StatusUpdate = (typeof STATUS_UPDATE)[number];

// Enterprise Status Enum
export enum EnterpriseStatus {
  APPROVE = 'approve',
  REJECT = 'reject',
}

// Subscription Type Enum
export enum SubscriptionType {
  MONTH = 'month',
  YEAR = 'year',
  FOURTEEN_DAY = '14day',
  LIVES = 'lives',
  COINS = 'coins',
}

// Library Filter Enum
export enum LibraryFilter {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

// Content Type Enum
export enum ContentType {
  PDF = 'pdf',
  PPT = 'ppt',
  AUDIO = 'audio',
  IMAGE = 'image',
  YOUTUBE = 'youtube',
  NOTE = 'note',
  POWERPOINT = 'powerpoint',
  MANUAL = 'manual',
}

export const CONTENT_TYPES = Object.values(ContentType);
export type ContentTypeValue = ContentType;

// Processing Status Enum
export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export const PROCESSING_STATUS_VALUES = Object.values(ProcessingStatus);
export type ProcessingStatusValue = ProcessingStatus;

// Game Type Enum
export enum GameType {
  SINGLE = 'single',
  MULTIPLAYER = 'multiplayer',
}

// Game Mode Enum
export enum GameMode {
  DUEL = 'duel',
  BRAWL = 'brawl',
  TEAM = 'team',
}

// Difficulty Enum
export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

// Brawl Game Type Enum
export enum BrawlGameType {
  REGULAR = 'regular',
  KNOCKOUT = 'knockout',
}

// Deck Selection Method Enum
export enum DeckSelectionMethod {
  RANDOM = 'random',
  SELECTED = 'selected',
}

// Game Battle Mode Enum
export enum GameBattleMode {
  DUEL = 'DUEL',
  BRAWL = 'BRAWL',
}

// Game Battle Type Enum
export enum GameBattleType {
  REGULAR = 'REGULAR',
  KNOCKOUT = 'KNOCKOUT',
}

// Game Battle Status Enum
export enum GameBattleStatus {
  WAITING = 'WAITING',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}
