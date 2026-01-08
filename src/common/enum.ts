// User related enums
export const USER_ROLE = ['admin', 'userLogin'] as const;
export const USER_TYPE = [
  'individual',
  'superAdmin',
  'admin',
  'member',
  'enterprise'
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

export const ENTERPRISE_STATUS_VALUES = ['approve', 'reject'] as const;

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

export const LIBRARY_FILTER_VALUES = ['private', 'public'] as const;

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
export const CONTENT_TYPE_VALUES = ['pdf', 'ppt', 'audio', 'image', 'youtube', 'note', 'powerpoint', 'manual'] as const;
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
export const PROCESSING_STATUS_ARRAY = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
export type ProcessingStatusValue = ProcessingStatus;

// Game Type Enum
export enum GameType {
  SINGLE = 'single',
  MULTIPLAYER = 'multiplayer',
}

export const GAME_TYPE_VALUES = ['single', 'multiplayer'] as const;

// Game Mode Enum
export enum GameMode {
  DUEL = 'duel',
  BRAWL = 'brawl',
  TEAM = 'team',
}

export const GAME_MODE_VALUES = ['duel', 'brawl', 'team'] as const;

// Difficulty Enum
export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

export const DIFFICULTY_VALUES = ['easy', 'medium', 'hard'] as const;

// Brawl Game Type Enum
export enum BrawlGameType {
  REGULAR = 'regular',
  KNOCKOUT = 'knockout',
}

export const BRAWL_GAME_TYPE_VALUES = ['regular', 'knockout'] as const;

// Deck Selection Method Enum
export enum DeckSelectionMethod {
  RANDOM = 'random',
  SELECTED = 'selected',
}

export const DECK_SELECTION_METHOD_VALUES = ['random', 'selected'] as const;

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
