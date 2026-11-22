import fs from 'node:fs';
import path from 'node:path';

import settings from '@guestlinelabs/oc-registry/resources/settings';

const DEBOUNCE_MS = 100;

/**
 * Watch `baseDir` for file changes and report them through `changed`.
 *
 * Replaces chokidar with `fs.watch`. `fs.watch` reports a single `rename`
 * event for additions, modifications and deletions alike, which is fine
 * here because every event triggers the same re-package + live-reload
 * refresh. Events are debounced per file to coalesce the duplicate
 * notifications filesystems emit.
 *
 * `fs.watch({ recursive: true })` is supported on macOS and Windows; on
 * platforms without recursive support (Linux) every existing subdirectory
 * is watched individually and directories created later are picked up as
 * they appear.
 */
export default function watch(
  dirs: string[],
  baseDir: string,
  changed: (err: Error | null, fileName: string, componentDir?: string) => void
): fs.FSWatcher[] {
  const root = path.resolve(baseDir);
  const ignored = settings.filesToIgnoreOnDevWatch;
  const watchers = new Set<fs.FSWatcher>();
  const watchedDirs = new Set<string>();
  const pending = new Map<string, NodeJS.Timeout>();
  let recursiveMode = true;

  const isIgnored = (fileName: string) =>
    ignored.test(fileName) || ignored.test(path.relative(root, fileName));

  const report = (fileName: string) => {
    const componentDir = dirs.find((dir) =>
      Boolean(fileName.match(escapeRegularExpression(dir + path.sep)))
    );
    changed(null, fileName, componentDir);
  };

  const registerTree = (dir: string): void => {
    addWatcher(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(dir, entry.name);
      if (isIgnored(sub)) continue;
      registerTree(sub);
    }
  };

  const onEvent = (
    watchedDir: string,
    eventType: string,
    filename: string | Buffer | null
  ) => {
    if (!filename) return;
    const fileName = path.resolve(
      watchedDir,
      Buffer.isBuffer(filename) ? filename.toString() : filename
    );
    if (isIgnored(fileName)) return;

    if (!recursiveMode && eventType === 'rename') {
      // A new directory may have appeared; watch its contents too.
      try {
        if (fs.statSync(fileName).isDirectory()) {
          registerTree(fileName);
        }
      } catch {
        // File was removed again or is not accessible.
      }
    }

    // Directory entries carry no file content to repackage — changes to
    // the files inside them are reported as their own events. Some tools
    // (notably Bun's `fs.cp`, used when copying `oc.files.static`
    // directories during packaging) also emit spurious `rename` events on
    // the *source* directory, which would otherwise retrigger packaging
    // on every build.
    try {
      if (fs.statSync(fileName).isDirectory()) {
        return;
      }
    } catch {
      // Missing or inaccessible path (e.g. just deleted) — treat as a change.
    }

    const existing = pending.get(fileName);
    if (existing) clearTimeout(existing);
    pending.set(
      fileName,
      setTimeout(() => {
        pending.delete(fileName);
        report(fileName);
      }, DEBOUNCE_MS)
    );
  };

  const onError = (err: unknown) => {
    changed(err instanceof Error ? err : new Error(String(err)), '', undefined);
  };

  const addWatcher = (dir: string): void => {
    const resolved = path.resolve(dir);
    if (watchedDirs.has(resolved)) return;
    watchedDirs.add(resolved);
    try {
      const watcher = fs.watch(
        resolved,
        { recursive: recursiveMode },
        (eventType, filename) => onEvent(resolved, eventType, filename)
      );
      watcher.on('error', onError);
      watchers.add(watcher);
    } catch {
      watchedDirs.delete(resolved);
    }
  };

  try {
    const watcher = fs.watch(root, { recursive: true }, (eventType, filename) =>
      onEvent(root, eventType, filename)
    );
    watcher.on('error', onError);
    watchers.add(watcher);
    watchedDirs.add(root);
  } catch {
    // `recursive` is unsupported on this platform (e.g. Linux).
    recursiveMode = false;
    registerTree(root);
  }

  return [...watchers];
}

function escapeRegularExpression(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
