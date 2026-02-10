import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.canvas-mcp');
const PREFS_FILE = path.join(DATA_DIR, 'preferences.json');
const CONTEXT_FILE = path.join(DATA_DIR, 'context.json');
const MAX_CONTEXT_NOTES = 200;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

// ==================== PREFERENCES ====================

export interface UserPreferences {
  display: Record<string, unknown>;
  priorities: Record<string, unknown>;
  behavior: Record<string, unknown>;
  courses: Record<string, Record<string, unknown>>;
  last_updated?: string;
}

const DEFAULT_PREFS: UserPreferences = {
  display: {},
  priorities: {},
  behavior: {},
  courses: {},
};

export function loadPreferences(): UserPreferences {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
      return { ...DEFAULT_PREFS, ...data };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_PREFS };
}

export function savePreferences(prefs: UserPreferences): void {
  ensureDataDir();
  prefs.last_updated = new Date().toISOString();
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), { mode: 0o600 });
}

export function setPreference(category: string, key: string, value: unknown): UserPreferences {
  const prefs = loadPreferences();
  if (category === 'courses') {
    if (!prefs.courses[key]) prefs.courses[key] = {};
    if (typeof value === 'object' && value !== null) {
      Object.assign(prefs.courses[key], value);
    } else {
      prefs.courses[key] = { value };
    }
  } else if (category in prefs && typeof prefs[category as keyof UserPreferences] === 'object') {
    (prefs[category as keyof UserPreferences] as Record<string, unknown>)[key] = value;
  } else {
    throw new Error(`Invalid category: ${category}. Use display, priorities, behavior, or courses.`);
  }
  savePreferences(prefs);
  return prefs;
}

export function deletePreference(category: string, key: string): boolean {
  const prefs = loadPreferences();
  if (category === 'courses') {
    if (key in prefs.courses) {
      delete prefs.courses[key];
      savePreferences(prefs);
      return true;
    }
  } else if (category in prefs && typeof prefs[category as keyof UserPreferences] === 'object') {
    const obj = prefs[category as keyof UserPreferences] as Record<string, unknown>;
    if (key in obj) {
      delete obj[key];
      savePreferences(prefs);
      return true;
    }
  }
  return false;
}

// ==================== CONTEXT NOTES ====================

export interface ContextNote {
  timestamp: string;
  note: string;
  source: 'observation' | 'user_statement' | 'implicit';
}

export interface ContextData {
  workflow_patterns: ContextNote[];
  conversation_notes: ContextNote[];
  preferences_applied: ContextNote[];
}

const DEFAULT_CONTEXT: ContextData = {
  workflow_patterns: [],
  conversation_notes: [],
  preferences_applied: [],
};

export function loadContext(): ContextData {
  try {
    if (fs.existsSync(CONTEXT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8'));
      return { ...DEFAULT_CONTEXT, ...data };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_CONTEXT };
}

export function saveContext(context: ContextData): void {
  ensureDataDir();
  // Trim each category to MAX_CONTEXT_NOTES
  for (const key of Object.keys(context) as (keyof ContextData)[]) {
    if (context[key].length > MAX_CONTEXT_NOTES) {
      context[key] = context[key].slice(-MAX_CONTEXT_NOTES);
    }
  }
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2), { mode: 0o600 });
}

export function addContextNote(
  note: string,
  category: keyof ContextData = 'workflow_patterns',
  source: ContextNote['source'] = 'observation'
): ContextNote {
  const context = loadContext();
  const entry: ContextNote = {
    timestamp: new Date().toISOString(),
    note,
    source,
  };
  context[category].push(entry);
  saveContext(context);
  return entry;
}

export function clearOldNotes(daysOld: number): number {
  const context = loadContext();
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  let removed = 0;
  for (const key of Object.keys(context) as (keyof ContextData)[]) {
    const before = context[key].length;
    context[key] = context[key].filter(n => n.timestamp >= cutoff);
    removed += before - context[key].length;
  }
  if (removed > 0) saveContext(context);
  return removed;
}
