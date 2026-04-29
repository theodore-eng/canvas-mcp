import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Local state for `sync_course_to_local` and `diff_course_files`.
 *
 * Persists per-course snapshots of which files we've seen, when they were
 * last updated upstream, and where they live on disk. Powers two flows:
 *   - sync: only re-download files whose Canvas updated_at is newer than
 *     the recorded snapshot (or that don't exist locally).
 *   - diff: compare a fresh listing against the snapshot and report
 *     {added, updated, removed} so the LLM can surface "Canvas drops".
 *
 * Atomic writes via tmpfile + rename so concurrent reads never see a
 * partial JSON document.
 */

/**
 * Paths are computed lazily so tests can override HOME. Caching them at
 * module load would freeze the path before the test could redirect it.
 */
function dataDir(): string {
  return path.join(os.homedir(), '.canvas-mcp');
}
function syncStateFile(): string {
  return path.join(dataDir(), 'sync-state.json');
}

export interface SyncFileEntry {
  /** Canvas updated_at as recorded at last sync */
  updated_at: string | null;
  /** Canvas-reported size in bytes at last sync */
  size: number;
  /** Absolute local path where the file was written */
  local_path: string;
  /** Filename portion (sanitized) we wrote to disk */
  filename: string;
  /** Module label used for the on-disk subfolder */
  module_label: string;
}

export interface CourseSyncState {
  course_id: number;
  last_sync_at: string;
  /** keyed by Canvas file_id (stringified) */
  files: Record<string, SyncFileEntry>;
}

export interface SyncState {
  version: 1;
  courses: Record<string, CourseSyncState>;
  last_updated?: string;
}

const DEFAULT_STATE: SyncState = { version: 1, courses: {} };

function ensureDataDir(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadSyncState(): SyncState {
  const file = syncStateFile();
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      if (parsed && parsed.version === 1) {
        return {
          version: 1,
          courses: parsed.courses ?? {},
          last_updated: parsed.last_updated,
        };
      }
    }
  } catch { /* fall through to default */ }
  return { ...DEFAULT_STATE, courses: {} };
}

/**
 * Atomic write: serialize, write to a tmpfile, fsync to flush kernel page
 * cache to disk, then rename over the target. On POSIX, rename is atomic
 * when both paths are on the same filesystem (which they are — both inside
 * DATA_DIR). The fsync is essential: without it, a power failure between
 * the rename and the eventual cache flush can land an empty target file.
 */
export function saveSyncState(state: SyncState): void {
  ensureDataDir();
  state.last_updated = new Date().toISOString();
  const file = syncStateFile();
  const json = JSON.stringify(state, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  // Open with O_CREAT|O_WRONLY|O_TRUNC, write all bytes, fsync, close, rename.
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, json);
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync can fail on virtual filesystems (e.g. some test envs); the
      // rename below is still atomic on the same FS, so swallow.
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function getCourseSyncState(courseId: number): CourseSyncState | null {
  const state = loadSyncState();
  return state.courses[String(courseId)] ?? null;
}

export function upsertCourseSyncState(snapshot: CourseSyncState): void {
  const state = loadSyncState();
  state.courses[String(snapshot.course_id)] = snapshot;
  saveSyncState(state);
}
