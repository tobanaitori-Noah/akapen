#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { installSkill } from './server/lib/install-skill.js';
import { activateLicense } from './server/lib/license.js';
import { startServer } from './server/server.js';

function parseArgs(argv: string[]): {
  port: number;
  filePath?: string;
  shouldOpen: boolean;
  licenseKey?: string;
  shouldInstallSkill: boolean;
  force: boolean;
  showVersion: boolean;
} {
  let port = 51212;
  let shouldOpen = true;
  let filePath: string | undefined;
  let licenseKey: string | undefined;
  let shouldInstallSkill = false;
  let force = false;
  let showVersion = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      showVersion = true;
      continue;
    }
    if (arg === '--install-skill') {
      shouldInstallSkill = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--no-open') {
      shouldOpen = false;
      continue;
    }
    if (arg === '--port') {
      const value = argv[i + 1];
      i += 1;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) port = parsed;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0) port = parsed;
      continue;
    }
    if (arg === '--license') {
      const value = argv[i + 1];
      i += 1;
      if (typeof value === 'string' && value.length > 0) licenseKey = value;
      continue;
    }
    if (arg.startsWith('--license=')) {
      const value = arg.slice('--license='.length);
      if (value.length > 0) licenseKey = value;
      continue;
    }
    if (!arg.startsWith('-') && !filePath) filePath = path.resolve(arg);
  }
  return { port, filePath, shouldOpen, licenseKey, shouldInstallSkill, force, showVersion };
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function nextAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`空きポートが見つかりませんでした: ${start}-${start + 99}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.showVersion) {
  const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    version?: string;
  };
  console.log(`akapen ${pkg.version ?? 'unknown'}`);
  process.exit(0);
}
if (args.shouldInstallSkill) {
  const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = installSkill({
    cwd: process.cwd(),
    sourceDir: path.join(packageRoot, 'skills', 'akapen'),
    force: args.force,
  });
  console.log(`[akapen] ${result.message}`);
  process.exit(result.status === 'installed' ? 0 : 1);
}
if (args.licenseKey) {
  try {
    const status = await activateLicense(args.licenseKey);
    console.log(`[akapen] license activated: ${status.plan ?? 'unknown'}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[akapen] license activation failed: ${message}`);
    process.exit(1);
  }
}
const port = await nextAvailablePort(args.port);
const started = await startServer({ port, openPath: args.filePath });

console.log(`AkaPen running at ${started.url}`);
if (args.filePath) console.log(`[akapen] initial file: ${args.filePath}`);
if (args.shouldOpen) {
  await open(started.url);
}

process.on('SIGINT', () => {
  void started.close().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void started.close().finally(() => process.exit(0));
});
