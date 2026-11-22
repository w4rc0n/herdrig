'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const maxBytes = 1024 * 1024;
const maxModels = 256;
const modelId = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
const efforts = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const codexEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const unavailable = reason => ({ status: 'unavailable', reason });
const validId = value => typeof value === 'string' && modelId.test(value);
const labelOf = (text, fallback) => typeof text === 'string'
  ? text.replace(/[\p{Cc}\p{Cf}]+/gu, '').trim().slice(0, 100) || fallback
  : fallback;

function canonicalHome(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || home === path.parse(home).root
      || /[\x00-\x1f\x7f]/.test(home) || fs.realpathSync(home) !== home
      || !fs.lstatSync(home).isDirectory()) throw Error('invalid home');
  return home;
}

function readCache(home) {
  const file = path.join(canonicalHome(home), 'models_cache.json');
  const expected = fs.lstatSync(file);
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || !Number.isInteger(O_NONBLOCK) || !expected.isFile()
      || expected.uid !== process.getuid() || expected.size > maxBytes) throw Error('unsafe file');
  const fd = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const match = stat => stat.isFile() && stat.dev === expected.dev && stat.ino === expected.ino
      && stat.uid === expected.uid && stat.size === expected.size && stat.mtimeMs === expected.mtimeMs;
    if (!match(fs.fstatSync(fd))) throw Error('file changed');
    const buffer = Buffer.alloc(expected.size);
    let count = 0;
    while (count < buffer.length) {
      const size = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    if (count !== expected.size || !match(fs.fstatSync(fd))) throw Error('file changed');
    return codexCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))));
  } finally {
    fs.closeSync(fd);
  }
}

function codexCatalog(data) {
  if (!data || !Array.isArray(data.models) || data.models.length > maxModels) throw Error('unknown catalog');
  const seen = new Set();
  const models = [];
  for (const row of data.models) {
    const levels = row?.supported_reasoning_levels;
    if (!validId(row?.slug) || seen.has(row.slug) || typeof row.display_name !== 'string'
        || !['list', 'hide'].includes(row.visibility) || !Array.isArray(levels)
        || levels.length > codexEfforts.size || levels.some(level => !codexEfforts.has(level?.effort))) throw Error('unknown model entry');
    seen.add(row.slug);
    const available = [...new Set(levels.map(level => level.effort))];
    if (row.default_reasoning_level != null && !available.includes(row.default_reasoning_level)) throw Error('unknown default effort');
    if (row.visibility === 'list') models.push({
      id: row.slug,
      label: labelOf(row.display_name, row.slug),
      efforts: available,
    });
  }
  const fetchedAt = typeof data.fetched_at === 'string' ? Date.parse(data.fetched_at) : NaN;
  return { status: 'ready', source: 'codex-local-model-list', models,
    ...(Number.isFinite(fetchedAt) ? { fetchedAt } : {}) };
}

function command(command, args, home) {
  const env = { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', TERM: 'dumb' };
  if (home) env.PI_CODING_AGENT_DIR = canonicalHome(home);
  const result = spawnSync(command, args, {
    env, encoding: 'utf8', timeout: 7000, maxBuffer: maxBytes,
    input: '', windowsHide: true,
  });
  if (result.error || result.status !== 0) throw Error('command unavailable');
  return result.stdout;
}

function claudeExecutable(home) {
  const personal = typeof home === 'string' && path.isAbsolute(home) && home !== path.parse(home).root
    ? ['.local/bin/claude', '.npm-global/bin/claude'].map(relative => path.join(home, relative)) : [];
  const trustedOwner = stat => stat.uid === 0 || stat.uid === process.getuid();
  const candidates = [...personal, '/usr/local/bin/claude', '/opt/homebrew/bin/claude', '/usr/bin/claude'];
  for (const candidate of candidates) {
    try {
      const executable = fs.realpathSync(candidate);
      const stat = fs.statSync(executable);
      if (!stat.isFile() || !trustedOwner(stat) || (stat.mode & 0o022)) continue;
      fs.accessSync(executable, fs.constants.X_OK);
      let folder = path.dirname(executable);
      for (;;) {
        const parent = fs.statSync(folder);
        if (!parent.isDirectory() || !trustedOwner(parent) || (parent.mode & 0o002)) break;
        const next = path.dirname(folder);
        if (next === folder) return executable;
        folder = next;
      }
    } catch {
      // A missing or unsuitable executable leaves the next fixed candidate.
    }
  }
  throw Error('Claude executable unavailable');
}

function claudeCatalog(help) {
  const model = help.match(/^[ \t]+--model <[^>\r\n]+>([^\n]*(?:\n[ \t]{8,}[^\n]*)*)/m)?.[1];
  const aliases = model?.match(/\(e\.g\.\s*([^)]*)\)/)?.[1]?.match(/'[^']+'/g)?.map(value => value.slice(1, -1)) ?? [];
  const reported = help.match(/^[ \t]+--effort <[^>\r\n]+>[^\n]*(?:\n[ \t]{8,}[^\n]*)*/m)?.[0]?.match(/\(([^()]+)\)/)?.[1];
  const levels = reported?.split(/\s*,\s*/).filter(level => efforts.has(level)) ?? [];
  if (!aliases.length || aliases.length > maxModels || aliases.some(alias => !validId(alias))) return unavailable("The installed help doesn't list model aliases.");
  return {
    status: 'ready', source: 'claude-help',
    models: [...new Set(aliases)].map(id => ({ id, label: id, efforts: levels.length ? levels : null })),
    runtimeEfforts: levels.length ? levels : null,
  };
}

function piCatalog(output) {
  const [header, ...rows] = output.trim().split(/\r?\n/);
  if (!/^provider\s+model\b/i.test(header) || rows.length > maxModels) throw Error('unknown Pi model listing');
  const models = rows.filter(Boolean).map(line => {
    const [provider, model] = line.trim().split(/\s+/);
    const id = `${provider}/${model}`;
    if (!validId(provider) || !validId(model) || !validId(id)) throw Error('unknown Pi model entry');
    return { id, label: id, efforts: null };
  });
  return { status: 'ready', source: 'pi-cli', models };
}

function ompCatalog(output) {
  const result = JSON.parse(output);
  const rows = Array.isArray(result) ? result : result?.models;
  if (!Array.isArray(rows) || rows.length > maxModels) throw Error('unknown OMP model listing');
  const models = rows.map(row => {
    const id = `${row?.provider}/${row?.id}`;
    if (!validId(row?.provider) || !validId(row?.id) || !validId(id)) throw Error('unknown OMP model entry');
    const levels = Array.isArray(row.thinkingLevels) && row.thinkingLevels.every(level => efforts.has(level))
      ? [...new Set(row.thinkingLevels)] : null;
    return { id, label: labelOf(row.name, id), efforts: levels };
  });
  return { status: 'ready', source: 'omp-cli', models };
}

function catalog(source, home) {
  switch (source) {
    case 'codex-cache': return readCache(home);
    case 'claude-help': return claudeCatalog(command(claudeExecutable(home), ['--help']));
    case 'pi-cli': return piCatalog(command('pi', ['--list-models'], canonicalHome(home)));
    case 'omp-cli': return ompCatalog(command('omp', ['models', '--json', '--no-extensions'], canonicalHome(home)));
    default: return unavailable('There is no supported catalog for this harness.');
  }
}

function readCatalog(source, home) {
  try {
    return catalog(source, home);
  } catch {
    return unavailable(source === 'codex-cache'
      ? "Codex's local model list is missing, unsafe, or uses an unfamiliar format."
      : "The harness didn't return a readable model list.");
  }
}

module.exports = { readCache, readCatalog, claudeExecutable, claudeCatalog, piCatalog, ompCatalog };

if (require.main === module) {
  process.stdout.write(JSON.stringify(readCatalog(...process.argv.slice(2, 4))) + '\n');
}
