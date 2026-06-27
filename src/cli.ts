#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import open from 'open';
import { activateLicense } from './server/lib/license.js';
import { startServer } from './server/server.js';

function parseArgs(argv: string[]): {
  port: number;
  filePath?: string;
  shouldOpen: boolean;
  licenseKey?: string;
} {
  let port = 51212;
  let shouldOpen = true;
  let filePath: string | undefined;
  let licenseKey: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
  return { port, filePath, shouldOpen, licenseKey };
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
