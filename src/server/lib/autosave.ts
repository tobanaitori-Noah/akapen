import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Operations } from "@akapen/shared";

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/**
 * 自動保存の読み書き（plan18 T11・schemaVersion 2 = Operations List 保存形式）。
 *
 * - JSON 1ファイル / 1 base。キー＝base パスの sha256 先頭16桁。
 * - dir は呼び出し側（ipc.ts が `app.getPath('userData')/autosave`）が渡す＝テスト可能。
 * - fs エラーは write.ts と同じく throw せず {status:'error', message} に正規化
 *   （renderer がバナーで可視化する＝fire-and-forget で黙って失わない）。
 * - ENOENT（=存在しない）だけ「なし」扱い。それ以外のエラーは error として返す。
 *
 * ## schemaVersion 2 への移行（plan18 design §2-4 / §4-4 / requirements.md §4-1）
 * - workingMd 廃止 → operations を JSON で保存（OperationStore.persist() の戻り値をそのまま使う）
 * - schemaVersion 1 検出時は IntegrityError を throw する（移行ロジックは作らない・owner 検証段階）
 * - 復元時：derivedMd = applyOperations(baseRaw, operations) で再計算（呼び出し側＝renderer state.ts の責務）
 * - redoStack も persist 戻り値ごと保存・restore で復元（design §4-2「永続化ポリシー」）
 */

// ---------------------------------------------------------------------------
// 型定義（plan18 schemaVersion 2 = AutosaveEntryV2）
// ---------------------------------------------------------------------------

/** base ファイルのメタ（読込時点の hash/mtime/size・復元時の不一致検出用） */
export interface BaseStat {
  sha256: string;
  mtimeMs: number;
  size: number;
}

/**
 * autosave エントリ（schemaVersion 2 = Operations List 形式）。
 *
 * 旧 schemaVersion 1 (workingMd 形式) からの移行ロジックは作らない（owner 決定 2026-06-17）。
 * 旧形式を検出した場合は明示的に IntegrityError を throw する。
 *
 * - version: 2 固定（schemaVersion フィールドは廃止＝version で一本化）
 * - basePath: 開いたファイルの絶対パス
 * - baseOriginal: ディスク原文の全文スナップショット（復元の基準）
 * - baseStat: 読込時点の hash/mtime/size（base 不一致検出用）
 * - baseRaw: baseRaw（不変条件・operations 適用の基準）
 * - operations: 編集操作列（OperationStore.persist().operations）
 * - redoStack: redo スタック（OperationStore.persist().redoStack・空配列でも保存）
 * - globalNote: 全体コメント
 * - savedAt: 保存時刻（ISO 8601）
 */
export interface AutosaveEntryV2 {
  version: 2;
  basePath: string;
  baseOriginal: string;
  baseStat: BaseStat;
  baseRaw: string;
  operations: Operations;
  redoStack: Operations;
  globalNote: string;
  savedAt: string;
}

/** 後方互換エイリアス（呼び出し側の AutosaveEntry 参照を switching する間の橋渡し用・Phase 4 で解消） */
export type AutosaveEntry = AutosaveEntryV2;

export type AutosaveOpResult =
  | { status: "ok" }
  | { status: "error"; message: string };
export type AutosaveReadResult =
  | { status: "ok"; entry: AutosaveEntryV2 | null }
  | { status: "error"; message: string };
export type AutosaveListResult =
  | {
      status: "ok";
      items: Array<{ basePath: string; savedAt: string }>;
      corrupted: number;
    }
  | { status: "error"; message: string };

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
const isEnoent = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/**
 * plan18 段階で受け入れる schemaVersion の最大値。
 * v3 追加時はここを更新する。
 */
export const MAX_SCHEMA_VERSION = 2;

export function autosaveKey(basePath: string): string {
  return createHash("sha256").update(basePath).digest("hex").slice(0, 16);
}

function fileFor(dir: string, basePath: string): string {
  return path.join(dir, `${autosaveKey(basePath)}.json`);
}

// ---------------------------------------------------------------------------
// 型ガード（schemaVersion 2 形式の検証）
// ---------------------------------------------------------------------------

/**
 * Operation 1 件のフィールドを最小限検証する。
 * JSON.parse 直後の unknown を信用せず、構造化された箇所だけ型ガードする。
 * （詳細な parentId チェーン整合は復元後 validateOperationChain に委ねる）
 */
function isOperationLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.type === "string" &&
    typeof v.from === "number" &&
    typeof v.to === "number" &&
    typeof v.origin === "string" &&
    typeof v.timestamp === "number"
  );
}

function isOperationsArrayLike(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(isOperationLike);
}

/**
 * JSON.parse 結果が schemaVersion 2 形式の AutosaveEntryV2 か検証する。
 * 欠落/型不正は「破損エントリ」としてエラー扱いになる。
 *
 * schemaVersion 1 形式（version === 1 / workingMd フィールド）は本関数では拒否する。
 * 旧形式の検出と IntegrityError throw は readAutosave 側で行う（メッセージを分けるため）。
 */
function isAutosaveEntryV2(value: unknown): value is AutosaveEntryV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const stat = v.baseStat as Record<string, unknown> | null | undefined;
  return (
    v.version === 2 &&
    typeof v.basePath === "string" &&
    typeof v.baseOriginal === "string" &&
    typeof v.baseRaw === "string" &&
    isOperationsArrayLike(v.operations) &&
    isOperationsArrayLike(v.redoStack) &&
    typeof v.globalNote === "string" &&
    typeof v.savedAt === "string" &&
    typeof stat === "object" &&
    stat !== null &&
    typeof stat.sha256 === "string" &&
    typeof stat.mtimeMs === "number" &&
    typeof stat.size === "number"
  );
}

/**
 * 旧 schemaVersion 1 形式の特徴を持つかを判定する（version === 1 or workingMd 含有）。
 * IntegrityError throw 判定のためだけに使う＝旧形式エントリの誤検出を狭くするため、
 * 明示シグナル（version === 1 か workingMd フィールド）に限定する。
 */
function looksLikeSchemaV1(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 || v.schemaVersion === 1 || typeof v.workingMd === "string"
  );
}

// ---------------------------------------------------------------------------
// I/O API
// ---------------------------------------------------------------------------

export function writeAutosave(
  dir: string,
  entry: AutosaveEntryV2,
): AutosaveOpResult {
  // K3.5 段階4（HIGH-4 修正・plan18 でも維持）: temp → rename の atomic write で
  // ENOSPC 等による truncate（唯一の recovery file 破損）を防ぐ。
  const target = fileFor(dir, entry.basePath);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(entry), "utf8");
    fs.renameSync(tmp, target);
    return { status: "ok" };
  } catch (err) {
    // 書込失敗時は tmp が残る場合があるが、次回 writeAutosave で上書きされる。
    // 削除試行のエラーは無視し、元のエラーを返す。
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { status: "error", message: messageOf(err) };
  }
}

/**
 * autosave エントリを読み込む。
 *
 * - ENOENT：「なし」扱い（{status:'ok', entry: null}）
 * - JSON.parse 失敗：error
 * - schemaVersion 1 検出（旧形式）：IntegrityError を throw する（plan18 design §4-4）
 *   ＝呼び出し側が catch して owner に「古い形式のデータが残っています」ダイアログを出す前提
 * - schemaVersion 2 形式不正：error（破損扱い）
 * - schemaVersion 2 形式正常：{status:'ok', entry}
 */
export function readAutosave(
  dir: string,
  basePath: string,
): AutosaveReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(fileFor(dir, basePath), "utf8");
  } catch (err) {
    if (isEnoent(err)) return { status: "ok", entry: null }; // 存在しない＝「なし」
    return { status: "error", message: messageOf(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: "error",
      message: `自動保存ファイルが破損しています: ${messageOf(err)}`,
    };
  }
  // 旧 schemaVersion 1 形式の検出は IntegrityError として明示的に throw する。
  // 移行ロジックは作らない＝owner 検証段階・配布前のため（requirements.md §4-1 / design §4-4）。
  if (looksLikeSchemaV1(parsed)) {
    throw new IntegrityError(
      "autosave: schemaVersion 1 (旧形式) が検出されました。" +
        "plan18 以降は schemaVersion 2 (Operations List 形式) のみサポートします。" +
        "旧形式からの自動移行は行いません＝owner が手動で対応してください。",
    );
  }
  if (!isAutosaveEntryV2(parsed)) {
    return {
      status: "error",
      message:
        "自動保存ファイルが破損しています（必須フィールドの欠落/型不正）",
    };
  }
  return { status: "ok", entry: parsed };
}

/**
 * autosave ディレクトリの一覧を返す。
 *
 * - 旧 schemaVersion 1 形式は「破損扱い」として corrupted に計上する
 *   （readAutosave とは違って list では throw しない＝一覧表示が止まると owner が起動できなくなるため）
 * - JSON.parse 失敗・schemaVersion 2 形式不正も corrupted に計上する
 */
export function listAutosaves(dir: string): AutosaveListResult {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (isEnoent(err)) return { status: "ok", items: [], corrupted: 0 }; // dir 未作成＝保存なし
    return { status: "error", message: messageOf(err) };
  }
  const items: Array<{ basePath: string; savedAt: string }> = [];
  let corrupted = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, name), "utf8");
    } catch (err) {
      if (isEnoent(err)) continue; // readdir と read の隙間で消えた＝なし扱い
      return { status: "error", message: `${name}: ${messageOf(err)}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      corrupted += 1; // 破損は無言で吸収しない＝件数を返し renderer がバナー表示
      continue;
    }
    if (isAutosaveEntryV2(parsed)) {
      items.push({ basePath: parsed.basePath, savedAt: parsed.savedAt });
    } else {
      // 旧 schemaVersion 1 形式も含めて破損扱い（list では throw しない＝起動を止めない）。
      corrupted += 1;
    }
  }
  items.sort((a, b) =>
    a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0,
  );
  return { status: "ok", items, corrupted };
}

export function removeAutosave(
  dir: string,
  basePath: string,
): AutosaveOpResult {
  try {
    fs.rmSync(fileFor(dir, basePath), { force: true }); // force=ENOENT は成功扱い
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: messageOf(err) };
  }
}
