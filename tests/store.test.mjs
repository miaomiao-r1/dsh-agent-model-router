import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { acquireLock, releaseLock, ROLE_NAMES, SettingsStore } from '../source/store.mjs';

const defaults = Object.fromEntries(ROLE_NAMES.map((role) => [role, {
  provider: 'default-provider',
  model: `default-${role}`,
  ignored: 'not persisted',
}]));

let directory;
let file;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'settings-store-'));
  file = join(directory, 'nested', 'settings.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function rolesWithModel(model) {
  return Object.fromEntries(ROLE_NAMES.map((role) => [role, {
    provider: 'test-provider',
    model: `${model}-${role}`,
  }]));
}

function conflict(error) {
  return error?.code === 'CONFLICT' && (error.status === 409 || error.statusCode === 409);
}

describe('SettingsStore', () => {
  it('exports a releasable SQLite lock lease and keeps its mutex database', async () => {
    const lockPath = `${file}.lock`;
    const lease = await acquireLock(lockPath);
    await assert.rejects(acquireLock(lockPath), conflict);
    await releaseLock(lease);
    await releaseLock(lease);

    const nextLease = await acquireLock(lockPath);
    await releaseLock(nextLease);
    assert.ok((await readdir(dirname(file))).includes('settings.json.lock.sqlite'));
  });

  it('reads defaults without creating a file and persists across store instances', async () => {
    const first = new SettingsStore({ file, defaults });
    const initial = await first.read();
    assert.equal(initial.version, 1);
    assert.equal(initial.effectiveFrom, 0);
    assert.equal(initial.roles.worker.model, 'default-worker');
    assert.equal('ignored' in initial.roles.worker, false);
    await assert.rejects(readFile(file));

    const saved = await first.save(rolesWithModel('saved'), 1);
    assert.equal(saved.version, 2);
    const restarted = new SettingsStore({ file, defaults: rolesWithModel('other-default') });
    assert.deepEqual(await restarted.read(), saved);
  });

  it('selects the revision effective at a session creation time', async () => {
    let now = 100;
    const store = new SettingsStore({ file, defaults, now: () => now });
    await store.save(rolesWithModel('first'), 1);
    now = 200;
    await store.save(rolesWithModel('second'), 2);

    assert.equal((await store.forSession('before', 50)).version, 1);
    assert.equal((await store.forSession('at-first', 100)).version, 2);
    assert.equal((await store.forSession('between', 199)).version, 2);
    assert.equal((await store.forSession('at-second', 200)).version, 3);
  });

  it('chooses the greatest version when revisions share an effective time', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    await store.save(rolesWithModel('first'), 1);
    await store.save(rolesWithModel('second'), 2);
    const atTime = await store.forSession('same-time', 100);
    assert.equal(atTime.version, 3);
    assert.equal(atTime.roles.worker.model, 'second-worker');
  });

  it('returns cloned snapshots that callers cannot mutate', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    const saved = await store.save(rolesWithModel('saved'), 1);
    const session = await store.forSession('session', 100);
    saved.roles.worker.model = 'mutated-save-result';
    session.roles.worker.provider = 'mutated-session-result';

    const current = await store.read();
    assert.equal(current.roles.worker.model, 'saved-worker');
    assert.equal(current.roles.worker.provider, 'test-provider');
  });

  it('rejects stale expected versions with a conflict response', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    await store.save(rolesWithModel('first'), 1);
    await assert.rejects(store.save(rolesWithModel('stale'), 1), conflict);
    assert.equal((await store.read()).roles.worker.model, 'first-worker');
  });

  it('validates the complete six-role mapping and persists only provider/model', async () => {
    const store = new SettingsStore({ file, defaults });
    const invalid = [
      {},
      { ...rolesWithModel('x'), worker: { provider: '', model: 'x' } },
      { ...rolesWithModel('x'), worker: { provider: 'x', model: '  ' } },
      { ...rolesWithModel('x'), worker: { provider: 'x'.repeat(201), model: 'x' } },
      { ...rolesWithModel('x'), worker: { provider: 'x', model: 'm'.repeat(201) } },
    ];
    for (const roles of invalid) await assert.rejects(store.save(roles, 1));

    const roles = rolesWithModel('valid');
    roles.worker.extra = 'discard me';
    await store.save(roles, 1);
    assert.deepEqual(Object.keys((await store.read()).roles.worker).sort(), ['model', 'provider']);
  });

  it('does not replace malformed JSON with defaults', async () => {
    const original = '{ definitely not json';
    const store = new SettingsStore({ file, defaults });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, original, 'utf8');

    await assert.rejects(store.read());
    await assert.rejects(store.save(rolesWithModel('replacement'), 1));
    assert.equal(await readFile(file, 'utf8'), original);
  });

  it('rejects missing, non-finite, non-positive, and non-numeric session times', async () => {
    const store = new SettingsStore({ file, defaults });
    for (const createdAt of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '10']) {
      await assert.rejects(store.forSession('invalid', createdAt));
    }
  });

  it('serializes simultaneous saves so only one stale-version write succeeds', async () => {
    const first = new SettingsStore({ file, defaults, now: () => 100 });
    const second = new SettingsStore({ file, defaults, now: () => 101 });
    const results = await Promise.allSettled([
      first.save(rolesWithModel('one'), 1),
      second.save(rolesWithModel('two'), 1),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(conflict(rejected.reason));
    assert.equal((await first.read()).version, 2);
  });

  it('reports lock contention and leaves the existing file unchanged', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    await store.save(rolesWithModel('stable'), 1);
    const original = await readFile(file, 'utf8');
    await writeFile(`${file}.lock`, 'held by another writer', { flag: 'wx' });

    await assert.rejects(store.save(rolesWithModel('blocked'), 2), conflict);
    assert.equal(await readFile(file, 'utf8'), original);
    assert.deepEqual(await readdir(dirname(file)), [
      'settings.json',
      'settings.json.lock',
      'settings.json.lock.sqlite',
    ]);
  });

  it('rejects a save while a separate process holds the SQLite lock and recovers after it is killed', async () => {
    const store = new SettingsStore({ file, defaults });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    const databasePath = `${file}.lock.sqlite`;
    const childScript = `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv.at(-1));
      db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS lock_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
      console.log('locked');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, databasePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('locked')) resolve();
        });
        child.once('error', reject);
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.once('exit', (code) => reject(new Error(`lock child exited ${code}: ${output}`)));
      });
      await assert.rejects(store.save(rolesWithModel('blocked'), 1), conflict);
      child.kill('SIGKILL');
      await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
      });
      const saved = await store.save(rolesWithModel('recovered'), 1);
      assert.equal(saved.version, 2);
      assert.equal(saved.roles.worker.model, 'recovered-worker');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it('ignores an abandoned legacy recovery marker while retaining the persistent SQLite mutex', async () => {
    const store = new SettingsStore({ file, defaults });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.lock.recovery`, JSON.stringify({
      pid: 2147483647,
      token: 'abandoned-recovery',
      createdAt: Date.now(),
    }));

    const saved = await store.save(rolesWithModel('saved'), 1);
    assert.equal(saved.version, 2);
    assert.equal(await readFile(`${file}.lock.recovery`, 'utf8').then((contents) => JSON.parse(contents).token), 'abandoned-recovery');
    assert.ok((await readdir(dirname(file))).includes('settings.json.lock.sqlite'));
  });

  it('recovers a lock whose recorded owner process no longer exists', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.lock`, JSON.stringify({ pid: 2147483647, token: 'abandoned', createdAt: 100 }));

    const saved = await store.save(rolesWithModel('recovered'), 1);
    assert.equal(saved.version, 2);
    assert.equal(saved.roles.worker.model, 'recovered-worker');
  });

  it('does not recover a lock owned by a live process', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.lock`, JSON.stringify({ pid: process.pid, token: 'active', createdAt: 100 }));

    await assert.rejects(store.save(rolesWithModel('blocked'), 1), conflict);
    assert.equal((JSON.parse(await readFile(`${file}.lock`, 'utf8'))).token, 'active');
  });

  it('allows only one writer to recover the same dead-owner lock', async () => {
    const first = new SettingsStore({ file, defaults, now: () => 100 });
    const second = new SettingsStore({ file, defaults, now: () => 101 });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.lock`, JSON.stringify({ pid: 2147483647, token: 'abandoned', createdAt: 100 }));

    const results = await Promise.allSettled([
      first.save(rolesWithModel('one'), 1),
      second.save(rolesWithModel('two'), 1),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.ok(conflict(results.find((result) => result.status === 'rejected').reason));
    assert.equal((await first.read()).version, 2);
  });

  it('does not recover a freshly damaged lock', async () => {
    const store = new SettingsStore({ file, defaults, now: () => Date.now() });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    const damaged = '{';
    await writeFile(`${file}.lock`, damaged);

    await assert.rejects(store.save(rolesWithModel('blocked'), 1), conflict);
    assert.equal(await readFile(`${file}.lock`, 'utf8'), damaged);
  });

  it('leaves the old file intact when a save cannot create a valid revision', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    await store.save(rolesWithModel('stable'), 1);
    const original = await readFile(file, 'utf8');
    const invalidClock = new SettingsStore({ file, defaults, now: () => Number.NaN });

    await assert.rejects(invalidClock.save(rolesWithModel('failed'), 2));
    assert.equal(await readFile(file, 'utf8'), original);
  });

  it('defaults the global enabled switch to false and reads legacy files as disabled', async () => {
    const store = new SettingsStore({ file, defaults });
    assert.equal((await store.read()).enabled, false);

    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      schema: 1,
      revisions: [{ version: 1, effectiveFrom: 0, roles: defaults }],
    }));
    assert.equal((await store.read()).enabled, false);
  });

  it('persists enabled across store instances and applies it to old session snapshots', async () => {
    let now = 100;
    const store = new SettingsStore({ file, defaults, now: () => now });
    const oldRoles = rolesWithModel('old');
    await store.save(oldRoles, 1);
    now = 200;
    const toggled = await store.saveEnabled(true, 2);
    assert.equal(toggled.version, 3);
    assert.equal(toggled.enabled, true);
    assert.equal(toggled.roles.worker.model, 'old-worker');
    const roleChange = await store.save(rolesWithModel('new'), 3);
    assert.equal(roleChange.enabled, true);

    const restarted = new SettingsStore({ file, defaults: rolesWithModel('different') });
    assert.equal((await restarted.read()).enabled, true);
    const oldSession = await restarted.forSession('old-run', 150);
    assert.equal(oldSession.version, 2);
    assert.equal(oldSession.roles.worker.model, 'old-worker');
    assert.equal(oldSession.enabled, true);
  });

  it('validates enabled values and reports stale enabled-save versions as conflicts', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 100 });
    for (const invalid of [undefined, 0, 1, 'true', null]) {
      await assert.rejects(store.saveEnabled(invalid, 1));
    }
    await store.saveEnabled(true, 1);
    await assert.rejects(store.saveEnabled(false, 1), conflict);
    const current = await store.read();
    assert.equal(current.enabled, true);
    assert.equal(current.version, 2);
  });

  it('rejects discontinuous or backward revision histories without replacing them', async () => {
    const store = new SettingsStore({ file, defaults });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    const invalidStates = [
      {
        schema: 1,
        revisions: [{ version: 2, effectiveFrom: 0, roles: defaults }],
      },
      {
        schema: 1,
        revisions: [
          { version: 1, effectiveFrom: 0, roles: defaults },
          { version: 3, effectiveFrom: 5, roles: rolesWithModel('gap') },
        ],
      },
      {
        schema: 1,
        revisions: [
          { version: 1, effectiveFrom: 0, roles: defaults },
          { version: 2, effectiveFrom: 5, roles: rolesWithModel('later') },
          { version: 3, effectiveFrom: 4, roles: rolesWithModel('backward') },
        ],
      },
    ];
    for (const invalidState of invalidStates) {
      const original = JSON.stringify(invalidState);
      await writeFile(file, original);
      await assert.rejects(store.read());
      await assert.rejects(store.saveEnabled(true, 3));
      assert.equal(await readFile(file, 'utf8'), original);
    }
  });

  it('rejects a clock that moves behind the current revision and keeps the file intact', async () => {
    const store = new SettingsStore({ file, defaults, now: () => 200 });
    await store.save(rolesWithModel('stable'), 1);
    const original = await readFile(file, 'utf8');
    const clockMovedBack = new SettingsStore({ file, defaults, now: () => 199 });

    await assert.rejects(clockMovedBack.saveEnabled(true, 2));
    assert.equal(await readFile(file, 'utf8'), original);
  });

  it('migrates legacy five-role revisions by backfilling the visioner role in memory', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    const legacyRoles = Object.fromEntries(ROLE_NAMES.filter((r) => r !== 'visioner').map((role) => [role, {
      provider: 'legacy-provider',
      model: `legacy-${role}`,
    }]));
    const original = JSON.stringify({
      schema: 1,
      enabled: true,
      revisions: [{ version: 1, effectiveFrom: 0, roles: legacyRoles }],
    });
    await writeFile(file, original, 'utf8');
    const store = new SettingsStore({ file, defaults });
    const first = await store.read();
    assert.equal(first.roles.visioner.provider, 'default-provider');
    assert.equal(first.roles.visioner.model, 'default-visioner');
    assert.equal(first.roles.explorer.model, 'legacy-explorer');
    // Read stays side-effect free: the legacy file is not rewritten.
    assert.equal(await readFile(file, 'utf8'), original);
    const second = await store.read();
    assert.equal(second.roles.visioner.model, 'default-visioner');
  });
});
