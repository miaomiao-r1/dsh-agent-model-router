import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const DAMAGED_LEGACY_LOCK_GRACE_MS = 5 * 60 * 1000;

function conflictError(message = 'settings are being updated by another writer') {
  const error = new Error(message);
  error.code = 'CONFLICT';
  error.status = 409;
  return error;
}

function parseLegacyMetadata(contents) {
  try {
    const metadata = JSON.parse(contents);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || !Number.isSafeInteger(metadata.pid) || metadata.pid < 1
      || typeof metadata.token !== 'string' || metadata.token.length === 0
      || !Number.isFinite(metadata.createdAt) || metadata.createdAt < 0) {
      return undefined;
    }
    return metadata;
  } catch {
    return undefined;
  }
}

function processIsConfirmedDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM and every result other than ESRCH are treated as live or unknown.
    return error.code === 'ESRCH';
  }
}

function sameIdentity(before, after) {
  return before.stat.dev === after.stat.dev
    && before.stat.ino === after.stat.ino
    && before.stat.size === after.stat.size
    && before.stat.mtimeMs === after.stat.mtimeMs
    && before.contents === after.contents;
}

async function readLegacySnapshot(path) {
  const lockStat = await stat(path);
  const contents = await readFile(path, 'utf8');
  return { stat: lockStat, contents };
}

async function removeAbandonedLegacyLock(path, before) {
  let after;
  try {
    after = await readLegacySnapshot(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!sameIdentity(before, after)) throw conflictError();
  await rm(path);
}

async function checkLegacyLock(lockPath) {
  let snapshot;
  try {
    snapshot = await readLegacySnapshot(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  const metadata = parseLegacyMetadata(snapshot.contents);
  if (metadata) {
    if (!processIsConfirmedDead(metadata.pid)) throw conflictError();
    await removeAbandonedLegacyLock(lockPath, snapshot);
    return;
  }

  // Legacy lock files could be empty or malformed if a process crashed before
  // finishing metadata. Preserve fresh ones; reclaim only after five minutes.
  const age = Date.now() - snapshot.stat.mtimeMs;
  if (!Number.isFinite(age) || age < DAMAGED_LEGACY_LOCK_GRACE_MS) {
    throw conflictError();
  }
  await removeAbandonedLegacyLock(lockPath, snapshot);
}

function isSqliteBusy(error) {
  return error?.errcode === 5 || error?.errcode === 6
    || /SQLITE_BUSY|SQLITE_LOCKED|database is (?:locked|busy)/i.test(
      `${error?.code ?? ''} ${error?.message ?? ''}`,
    );
}

export async function acquireLock(lockPath) {
  if (typeof lockPath !== 'string' || lockPath.length === 0) {
    throw new TypeError('lockPath is required');
  }
  await mkdir(dirname(lockPath), { recursive: true });
  const databasePath = `${lockPath}.sqlite`;
  let database;
  try {
    database = new DatabaseSync(databasePath);
    database.exec('PRAGMA busy_timeout = 0; CREATE TABLE IF NOT EXISTS lock_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    await checkLegacyLock(lockPath);
    return { database, databasePath, released: false };
  } catch (error) {
    if (database) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // BEGIN may have failed before a transaction was active.
      }
      database.close();
    }
    if (isSqliteBusy(error)) throw conflictError();
    throw error;
  }
}

export async function releaseLock(lease) {
  if (!lease || lease.released || !lease.database) return;
  lease.released = true;
  let rollbackError;
  try {
    lease.database.exec('ROLLBACK');
  } catch (error) {
    rollbackError = error;
  } finally {
    lease.database.close();
  }
  if (rollbackError) throw rollbackError;
}
