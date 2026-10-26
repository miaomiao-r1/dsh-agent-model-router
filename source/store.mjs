import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { acquireLock, releaseLock } from './lock.mjs';

export { acquireLock, releaseLock } from './lock.mjs';

export const ROLE_NAMES = Object.freeze([
  'explorer',
  'worker',
  'tester',
  'researcher',
  'reviewer',
  'visioner',
  'scribe',
]);

function conflictError(message) {
  const error = new Error(message);
  error.code = 'CONFLICT';
  error.status = 409;
  return error;
}

function copyRoles(roles) {
  return Object.fromEntries(ROLE_NAMES.map((role) => [role, {
    provider: roles[role].provider,
    model: roles[role].model,
  }]));
}

function validateRoles(roles) {
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
    throw new TypeError('roles must be an object containing all seven roles');
  }
  const keys = Object.keys(roles);
  if (keys.length !== ROLE_NAMES.length || ROLE_NAMES.some((role) => !Object.hasOwn(roles, role))) {
    throw new TypeError('roles must contain exactly the seven supported roles');
  }
  for (const role of ROLE_NAMES) {
    const config = roles[role];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError(`configuration for ${role} must be an object`);
    }
    for (const field of ['provider', 'model']) {
      const value = config[field];
      if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
        throw new TypeError(`${role}.${field} must be a non-empty string of at most 200 characters`);
      }
    }
  }
  return copyRoles(roles);
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || state.schema !== 1 || !Array.isArray(state.revisions) || state.revisions.length === 0) {
    throw new TypeError('settings file has an invalid schema');
  }
  const enabled = state.enabled ?? false;
  if (typeof enabled !== 'boolean') throw new TypeError('settings file enabled must be boolean');
  const revisions = state.revisions.map((revision) => {
    if (!revision || typeof revision !== 'object' || Array.isArray(revision)
      || !Number.isSafeInteger(revision.version) || revision.version < 1
      || !Number.isFinite(revision.effectiveFrom) || revision.effectiveFrom < 0) {
      throw new TypeError('settings file contains an invalid revision');
    }
    return {
      version: revision.version,
      effectiveFrom: revision.effectiveFrom,
      roles: validateRoles(revision.roles),
    };
  });
  if (revisions[0].version !== 1 || revisions[0].effectiveFrom !== 0) {
    throw new TypeError('settings history must start at version 1 and time 0');
  }
  for (let index = 1; index < revisions.length; index += 1) {
    if (revisions[index].version !== revisions[index - 1].version + 1
      || revisions[index].effectiveFrom < revisions[index - 1].effectiveFrom) {
      throw new TypeError('settings history must have continuous versions and non-decreasing times');
    }
  }
  return { schema: 1, enabled, revisions };
}

function snapshot(revision, enabled) {
  return {
    version: revision.version,
    effectiveFrom: revision.effectiveFrom,
    roles: copyRoles(revision.roles),
    enabled,
  };
}

export class SettingsStore {
  constructor({ file, defaults, now = Date.now }) {
    if (typeof file !== 'string' || file.length === 0) throw new TypeError('file is required');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.file = file;
    this.defaults = validateRoles(defaults);
    this.now = now;
  }

  async #readState() {
    let contents;
    try {
      contents = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          schema: 1,
          enabled: false,
          revisions: [{ version: 1, effectiveFrom: 0, roles: this.defaults }],
        };
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch (cause) {
      const error = new TypeError('settings file contains malformed JSON', { cause });
      throw error;
    }
    // Migrate legacy revisions that predate a role: backfill any missing role
    // from the defaults so old five-role settings files upgrade transparently.
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.revisions)) {
      for (const revision of parsed.revisions) {
        if (revision && revision.roles && typeof revision.roles === 'object') {
          for (const role of ROLE_NAMES) {
            if (!Object.hasOwn(revision.roles, role)) revision.roles[role] = this.defaults[role];
          }
        }
      }
    }
    return validateState(parsed);
  }

  async read() {
    const state = await this.#readState();
    const current = state.revisions.reduce((best, revision) => (
      revision.version > best.version ? revision : best
    ));
    return snapshot(current, state.enabled);
  }

  async save(roles, expectedVersion) {
    const cleanRoles = validateRoles(roles);
    return this.#commit({ roles: cleanRoles, expectedVersion });
  }

  async saveEnabled(enabled, expectedVersion) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    return this.#commit({ enabled, expectedVersion });
  }

  async #commit({ roles, enabled, expectedVersion }) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new TypeError('expectedVersion must be a positive integer');
    }

    const directory = dirname(this.file);
    await mkdir(directory, { recursive: true });

    const lockPath = `${this.file}.lock`;
    const lock = await acquireLock(lockPath);

    let tempPath;
    try {
      const state = await this.#readState();
      const current = state.revisions.reduce((best, revision) => (
        revision.version > best.version ? revision : best
      ));
      if (current.version !== expectedVersion) {
        throw conflictError(`expected version ${expectedVersion}, found ${current.version}`);
      }

      const effectiveFrom = this.now();
      if (!Number.isFinite(effectiveFrom) || effectiveFrom < 0) {
        throw new TypeError('now must return a finite non-negative timestamp');
      }
      if (effectiveFrom < current.effectiveFrom) {
        throw new TypeError('now must not move behind the current revision timestamp');
      }
      const revision = {
        version: current.version + 1,
        effectiveFrom,
        roles: roles ?? current.roles,
      };
      const nextState = {
        schema: 1,
        enabled: enabled ?? state.enabled,
        revisions: [...state.revisions, revision],
      };
      const serialized = `${JSON.stringify(nextState, null, 2)}\n`;
      tempPath = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      await writeAtomically(tempPath, this.file, serialized);
      return snapshot(revision, nextState.enabled);
    } finally {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => {});
      await releaseLock(lock).catch(() => {});
    }
  }

  async forSession(sessionId, createdAt) {
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
      throw new TypeError('createdAt must be a positive finite timestamp');
    }
    const state = await this.#readState();
    const eligible = state.revisions.filter((revision) => revision.effectiveFrom <= createdAt);
    const selected = eligible.reduce((best, revision) => {
      if (revision.effectiveFrom > best.effectiveFrom
        || (revision.effectiveFrom === best.effectiveFrom && revision.version > best.version)) {
        return revision;
      }
      return best;
    }, { version: 0, effectiveFrom: -1, roles: this.defaults });
    return snapshot(selected, state.enabled);
  }
}

async function writeAtomically(tempPath, targetPath, contents) {
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, targetPath);
}
