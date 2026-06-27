import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const POLAR_ORG_ID = '17b4815a-9e2c-4196-8c5f-68ceab098442';
export const POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_elVIqlJG60KiZ6ApP4b5hd7JYVjyHPfGs5MFE14ytSU';
export const POLAR_CHECKOUT_URL_SUPPORTER = 'https://buy.polar.sh/polar_cl_VpJIdymnwMcXL6BCFPAXWZVDuveWPKvRjQDdH0LBigX';

const POLAR_LICENSE_API =
  'https://api.polar.sh/v1/customer-portal/license-keys';
const OFFLINE_GRACE_DAYS = 30 as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LicensePlan = 'free' | 'standard' | 'supporter' | null;

export interface LicenseStatus {
  licensed: boolean;
  plan: LicensePlan;
  activationId: string | null;
  lastValidated: string | null;
  offlineGraceDays: 30;
}

export interface LicenseRecord {
  key: string;
  activationId: string;
  plan: Exclude<LicensePlan, 'free' | null>;
  lastValidated: string;
  expiresAt: string | null;
}

export interface LicenseOptions {
  userDataDir?: string;
  now?: Date;
}

type PolarValidateResponse = {
  status?: string;
  expires_at?: string | null;
  license_key?: unknown;
};

type PolarActivateResponse = {
  id?: string;
  activation_id?: string;
  expires_at?: string | null;
  license_key?: unknown;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function licenseFilePath(userDataDir?: string): string {
  return path.join(userDataDir ?? path.join(os.homedir(), '.akapen'), 'license.json');
}

export function readLicenseRecord(userDataDir?: string): LicenseRecord | null {
  try {
    const raw = fs.readFileSync(licenseFilePath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isLicenseRecord(parsed)) return null;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    return null;
  }
}

export function writeLicenseRecord(
  record: LicenseRecord,
  userDataDir?: string,
): { status: 'ok' } | { status: 'error'; message: string } {
  const target = licenseFilePath(userDataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    return { status: 'ok' };
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup failure; report the original write error
    }
    return { status: 'error', message: messageOf(error) };
  }
}

export function clearLicenseRecord(userDataDir?: string): void {
  try {
    fs.unlinkSync(licenseFilePath(userDataDir));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }
}

export async function validateLicenseKey(
  key: string,
  activationId: string,
): Promise<{ granted: boolean; plan: Exclude<LicensePlan, 'free' | null>; expiresAt: string | null }> {
  const data = await postPolar<PolarValidateResponse>('validate', {
    key,
    organization_id: POLAR_ORG_ID,
    activation_id: activationId,
  });
  return {
    granted: data.status === 'granted',
    plan: planFromPolar(data),
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
  };
}

export async function checkLicense(options: LicenseOptions = {}): Promise<LicenseStatus> {
  const record = readLicenseRecord(options.userDataDir);
  if (!record) return freeStatus();

  try {
    const validated = await validateLicenseKey(record.key, record.activationId);
    if (!validated.granted) {
      return {
        licensed: false,
        plan: null,
        activationId: record.activationId,
        lastValidated: record.lastValidated,
        offlineGraceDays: OFFLINE_GRACE_DAYS,
      };
    }
    const now = (options.now ?? new Date()).toISOString();
    const next: LicenseRecord = {
      ...record,
      plan: validated.plan,
      expiresAt: validated.expiresAt,
      lastValidated: now,
    };
    const written = writeLicenseRecord(next, options.userDataDir);
    if (written.status === 'error') throw new Error(written.message);
    return statusFromRecord(next, true);
  } catch {
    if (isWithinOfflineGrace(record.lastValidated, options.now ?? new Date())) {
      return statusFromRecord(record, true);
    }
    return {
      licensed: false,
      plan: null,
      activationId: record.activationId,
      lastValidated: record.lastValidated,
      offlineGraceDays: OFFLINE_GRACE_DAYS,
    };
  }
}

export async function activateLicense(
  key: string,
  options: LicenseOptions = {},
): Promise<LicenseStatus> {
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error('ライセンスキーを入力してください');
  const data = await postPolar<PolarActivateResponse>('activate', {
    key: normalizedKey,
    organization_id: POLAR_ORG_ID,
    label: os.hostname(),
    meta: {
      app: 'akapen',
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
    },
  });
  const activationId = data.id ?? data.activation_id;
  if (typeof activationId !== 'string' || activationId.length === 0) {
    throw new Error('Polar API の応答に activation_id がありません');
  }
  const now = (options.now ?? new Date()).toISOString();
  const record: LicenseRecord = {
    key: normalizedKey,
    activationId,
    plan: planFromPolar(data),
    lastValidated: now,
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
  };
  const written = writeLicenseRecord(record, options.userDataDir);
  if (written.status === 'error') throw new Error(written.message);
  return statusFromRecord(record, true);
}

export async function deactivateLicense(
  options: LicenseOptions = {},
): Promise<LicenseStatus> {
  const record = readLicenseRecord(options.userDataDir);
  if (!record) {
    clearLicenseRecord(options.userDataDir);
    return freeStatus();
  }
  await postPolar('deactivate', {
    key: record.key,
    organization_id: POLAR_ORG_ID,
    activation_id: record.activationId,
  });
  clearLicenseRecord(options.userDataDir);
  return freeStatus();
}

export async function isPremiumUnlocked(options: LicenseOptions = {}): Promise<boolean> {
  return (await checkLicense(options)).licensed;
}

function isLicenseRecord(value: unknown): value is LicenseRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.activationId === 'string' &&
    (v.plan === 'standard' || v.plan === 'supporter') &&
    typeof v.lastValidated === 'string' &&
    (typeof v.expiresAt === 'string' || v.expiresAt === null)
  );
}

function freeStatus(): LicenseStatus {
  return {
    licensed: false,
    plan: 'free',
    activationId: null,
    lastValidated: null,
    offlineGraceDays: OFFLINE_GRACE_DAYS,
  };
}

function statusFromRecord(record: LicenseRecord, licensed: boolean): LicenseStatus {
  return {
    licensed,
    plan: licensed ? record.plan : null,
    activationId: record.activationId,
    lastValidated: record.lastValidated,
    offlineGraceDays: OFFLINE_GRACE_DAYS,
  };
}

function isWithinOfflineGrace(lastValidated: string, now: Date): boolean {
  const validatedAt = Date.parse(lastValidated);
  if (!Number.isFinite(validatedAt)) return false;
  const ageMs = now.getTime() - validatedAt;
  return ageMs >= 0 && ageMs <= OFFLINE_GRACE_DAYS * MS_PER_DAY;
}

function planFromPolar(value: unknown): Exclude<LicensePlan, 'free' | null> {
  const text = JSON.stringify(value).toLowerCase();
  if (text.includes('supporter')) return 'supporter';
  return 'standard';
}

async function postPolar<T = unknown>(action: 'validate' | 'activate' | 'deactivate', body: unknown): Promise<T> {
  const res = await fetch(`${POLAR_LICENSE_API}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const text = await res.text();
      const data = text ? (JSON.parse(text) as { message?: string; error?: string }) : {};
      if (typeof data.message === 'string') message = data.message;
      else if (typeof data.error === 'string') message = data.error;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}
