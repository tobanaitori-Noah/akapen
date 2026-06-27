import { createHash } from 'node:crypto';
import fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';

export interface BaseWatcherOptions {
  debounceMs?: number;
  pollMs?: number;
}

export interface BaseWatcher {
  check(): void;
  close(): void;
}

export function createBaseWatcher(
  filePath: string,
  onChange: () => void,
  options: BaseWatcherOptions = {},
): BaseWatcher {
  const debounceMs = options.debounceMs ?? 300;
  const pollMs = options.pollMs ?? 2000;

  let closed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const statOf = (): { mtimeMs: number; size: number } | null => {
    try {
      const s = fs.statSync(filePath);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  };
  const hashOf = (): string | null => {
    try {
      return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
      return null;
    }
  };

  let lastStat = statOf();
  let lastHash = hashOf();

  const fire = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) onChange();
    }, debounceMs);
  };

  const evaluate = (suspect: boolean) => {
    if (closed) return;
    const st = statOf();
    const statChanged =
      (st === null) !== (lastStat === null) ||
      (st !== null &&
        lastStat !== null &&
        (st.mtimeMs !== lastStat.mtimeMs || st.size !== lastStat.size));
    if (!statChanged && !suspect) return;
    lastStat = st;
    const h = hashOf();
    if (h !== lastHash) {
      lastHash = h;
      fire();
    }
  };

  const watcher: FSWatcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });
  watcher.on('change', () => evaluate(true));
  watcher.on('add', () => evaluate(true));
  watcher.on('unlink', () => evaluate(true));
  watcher.on('error', () => undefined);

  const pollTimer = setInterval(() => evaluate(false), pollMs);
  pollTimer.unref?.();

  return {
    check() {
      evaluate(false);
    },
    close() {
      closed = true;
      void watcher.close();
      clearInterval(pollTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}
