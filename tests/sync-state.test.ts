import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadSyncState,
  saveSyncState,
  getCourseSyncState,
  upsertCourseSyncState,
  type CourseSyncState,
} from '../src/services/sync-state.js';

/**
 * sync-state writes to ~/.canvas-mcp/sync-state.json. To avoid polluting
 * the developer's real home dir, redirect HOME to a per-test tmpdir
 * before each test, then restore afterward. The service computes paths
 * lazily via os.homedir(), which honors $HOME on POSIX.
 */

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-mcp-test-'));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  // Clean up the tmp tree
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('sync-state load/save round-trip', () => {
  it('returns default empty state when no file exists', () => {
    const state = loadSyncState();
    expect(state.version).toBe(1);
    expect(state.courses).toEqual({});
    expect(state.last_updated).toBeUndefined();
  });

  it('persists a course snapshot and reads it back', () => {
    const snapshot: CourseSyncState = {
      course_id: 12345,
      last_sync_at: '2026-04-29T08:00:00.000Z',
      files: {
        '999': {
          updated_at: '2026-04-28T20:00:00.000Z',
          size: 1024,
          local_path: '/some/path/file.pdf',
          filename: 'file.pdf',
          module_label: 'Week 5',
        },
      },
    };
    upsertCourseSyncState(snapshot);

    const reloaded = loadSyncState();
    expect(reloaded.courses['12345']).toBeDefined();
    expect(reloaded.courses['12345'].course_id).toBe(12345);
    expect(reloaded.courses['12345'].files['999'].local_path).toBe('/some/path/file.pdf');
    expect(reloaded.last_updated).toBeTruthy();
  });

  it('getCourseSyncState returns null for unknown course', () => {
    expect(getCourseSyncState(99999)).toBeNull();
  });

  it('getCourseSyncState returns the snapshot after upsert', () => {
    const snapshot: CourseSyncState = {
      course_id: 7,
      last_sync_at: '2026-04-29T08:00:00.000Z',
      files: {},
    };
    upsertCourseSyncState(snapshot);
    const got = getCourseSyncState(7);
    expect(got).not.toBeNull();
    expect(got?.course_id).toBe(7);
  });

  it('writes file with mode 0600 (user-only read/write)', () => {
    saveSyncState({ version: 1, courses: {} });
    const file = path.join(tmpHome, '.canvas-mcp', 'sync-state.json');
    const stat = fs.statSync(file);
    // Mask out non-permission bits, compare against 0o600.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('upsert preserves other courses', () => {
    upsertCourseSyncState({ course_id: 1, last_sync_at: 't1', files: {} });
    upsertCourseSyncState({ course_id: 2, last_sync_at: 't2', files: {} });
    const state = loadSyncState();
    expect(Object.keys(state.courses).sort()).toEqual(['1', '2']);
  });

  it('returns default state when file is corrupted JSON', () => {
    // Write garbage to the state file
    fs.mkdirSync(path.join(tmpHome, '.canvas-mcp'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.canvas-mcp', 'sync-state.json'), '{not valid json');
    const state = loadSyncState();
    expect(state.courses).toEqual({});
  });

  it('rejects state files with the wrong version', () => {
    fs.mkdirSync(path.join(tmpHome, '.canvas-mcp'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.canvas-mcp', 'sync-state.json'),
      JSON.stringify({ version: 99, courses: { 1: { course_id: 1, last_sync_at: 't', files: {} } } }),
    );
    const state = loadSyncState();
    expect(state.courses).toEqual({}); // version mismatch -> default
  });
});
