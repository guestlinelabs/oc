#!/usr/bin/env bun
/**
 * Release all workspace packages together (they share one version).
 *
 *   bun run release                     publish the current version
 *   bun run release prerelease          1.0.0-alpha.0 -> 1.0.0-alpha.1
 *   bun run release patch|minor|major   semver increments (a prerelease
 *                                       graduates: 1.0.0-alpha.3 -> 1.0.0)
 *   bun run release 1.2.0               an explicit version
 *
 * Options:
 *   --preid <id>   prerelease identifier when starting one (default: alpha)
 *   --otp <code>   npm one-time password, passed to `bun publish`
 *   --dry-run      show what would happen; no files, commits, tags or uploads
 *
 * Steps: run `release:check`, bump every package.json + bun.lock, commit
 * "Release vX", tag vX, `bun publish --recursive` (dependency order, skips
 * versions already on npm, dist-tag = prerelease id or "latest"), then push
 * the commit and the tag. If publishing fails, fix the cause and run
 * `bun run release` again: it resumes from the local release commit. When the
 * version is already on npm for every package, it does nothing.
 */
import { parseArgs } from 'node:util';
import { $ } from 'bun';

const PACKAGES = ['packages/registry', 'packages/vite', 'packages/cli'];

type Version = { major: number; minor: number; patch: number; pre: string[] };

function parse(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`Not a valid version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : []
  };
}

function format({ major, minor, patch, pre }: Version): string {
  return `${major}.${minor}.${patch}${pre.length ? `-${pre.join('.')}` : ''}`;
}

/** Same results as `semver.inc` for the increments we support. */
export function increment(current: string, bump: string, id = 'alpha'): string {
  const v = parse(current);
  const isPre = v.pre.length > 0;
  switch (bump) {
    case 'major':
      return format(
        isPre && v.minor === 0 && v.patch === 0
          ? { ...v, pre: [] }
          : { major: v.major + 1, minor: 0, patch: 0, pre: [] }
      );
    case 'minor':
      return format(
        isPre && v.patch === 0
          ? { ...v, pre: [] }
          : { major: v.major, minor: v.minor + 1, patch: 0, pre: [] }
      );
    case 'patch':
      return format(
        isPre ? { ...v, pre: [] } : { ...v, patch: v.patch + 1, pre: [] }
      );
    case 'prerelease': {
      if (!isPre) return format({ ...v, patch: v.patch + 1, pre: [id, '0'] });
      const last = v.pre[v.pre.length - 1] ?? '';
      return /^\d+$/.test(last)
        ? format({
            ...v,
            pre: [...v.pre.slice(0, -1), String(Number(last) + 1)]
          })
        : format({ ...v, pre: [...v.pre, '0'] });
    }
    default:
      return format(parse(bump));
  }
}

/** npm dist-tag for a version: its prerelease id, or "latest". */
export function distTag(version: string): string {
  const [id] = parse(version).pre;
  return id && !/^\d+$/.test(id) ? id : 'latest';
}

async function readPackages(): Promise<{ name: string; version: string }[]> {
  return Promise.all(
    PACKAGES.map(async (dir) => Bun.file(`${dir}/package.json`).json())
  );
}

async function isOnNpm(name: string, version: string): Promise<boolean> {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`;
  const res = await fetch(url, { method: 'HEAD' });
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(
    `Could not check ${name}@${version} on npm: HTTP ${res.status}`
  );
}

async function writeVersion(version: string): Promise<void> {
  for (const dir of PACKAGES) {
    const file = `${dir}/package.json`;
    const pkg = await Bun.file(file).json();
    pkg.version = version;
    await Bun.write(file, `${JSON.stringify(pkg, null, '\t')}\n`);
  }
}

const git = async (...args: string[]) => (await $`git ${args}`.text()).trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      preid: { type: 'string', default: 'alpha' },
      otp: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }
    }
  });
  const dryRun = values['dry-run'] === true;

  const packages = await readPackages();
  const versions = packages.map((pkg) => pkg.version);
  if (new Set(versions).size !== 1) {
    throw new Error(`Packages are out of sync: ${versions.join(', ')}`);
  }
  const current = versions[0] as string;
  const bump = positionals[0];
  const target = bump ? increment(current, bump, values.preid) : current;
  const tag = distTag(target);
  const gitTag = `v${target}`;

  const published = await Promise.all(
    packages.map((pkg) => isOnNpm(pkg.name, target))
  );
  if (published.every(Boolean)) {
    console.log(
      `${target} is already on npm for every package; nothing to do.`
    );
    return;
  }
  if (target !== current && published.some(Boolean)) {
    throw new Error(`${target} is already on npm for some packages.`);
  }

  console.log(
    `Releasing ${target} (npm dist-tag "${tag}")${dryRun ? ' [dry run]' : ''}`
  );

  if (!dryRun) {
    if (await git('status', '--porcelain')) {
      throw new Error('Working tree is not clean; commit or stash first.');
    }
    await $`git fetch --quiet origin`;
    const head = await git('rev-parse', 'HEAD');
    const remote = await git('rev-parse', 'origin/main');
    // A rerun after a failed publish starts from the local release commit.
    const resuming = (await git('tag', '--points-at', 'HEAD'))
      .split('\n')
      .includes(gitTag);
    if (head !== remote && !resuming) {
      throw new Error('HEAD is not origin/main; pull or push first.');
    }
  }

  await $`bun run release:check`;

  if (target !== current) {
    if (dryRun) {
      console.log(
        `Would bump ${current} -> ${target}, commit and tag ${gitTag}`
      );
    } else {
      await writeVersion(target);
      await $`bun install`.quiet();
      await $`git commit --quiet -am ${`Release ${gitTag}`}`;
    }
  }
  if (!dryRun && !(await git('tag', '--list', gitTag))) {
    await $`git tag ${gitTag}`;
  }

  const extra = [
    ...(values.otp ? [`--otp=${values.otp}`] : []),
    ...(dryRun ? ['--dry-run'] : [])
  ];
  // release:check already built every package.
  await $`bun publish --recursive --tag ${tag} --ignore-scripts ${extra}`;

  if (!dryRun) {
    await $`git push --quiet origin main ${gitTag}`;
    console.log(`Published ${target} and pushed ${gitTag}`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
