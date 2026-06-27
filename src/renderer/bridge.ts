/**
 * AkapenBridge＝preload（window.akapen）と検証ハーネスのスタブが共有する最小契約。
 * renderer はこの型だけに依存し、Electron IPC の実体（Task 6 で配線）と
 * e2e/harness のメモリ内スタブを差し替えられるようにする（計画2 Task 5 Step 1）。
 */

import type { Operations } from "@akapen/shared";

export interface BaseStat {
  sha256: string; // base 全文の sha256
  mtimeMs: number;
  size: number;
}

/**
 * autosave エントリ（plan18 T15.7・schemaVersion 2 = AutosaveEntryV2）。
 *
 * Operations List 形式（main/lib/autosave.ts AutosaveEntryV2 と一致）：
 * - version: 2 固定（schemaVersion フィールドは廃止＝version で一本化）
 * - basePath: 開いたファイルの絶対パス
 * - baseOriginal: ディスク原文の全文スナップショット（復元の基準）
 * - baseStat: 読込時点の hash/mtime/size（base 不一致検出用）
 * - baseRaw: baseRaw（不変条件・operations 適用の基準）
 * - operations: 編集操作列（OperationStore.persist().operations）
 * - redoStack: redo スタック（OperationStore.persist().redoStack・空配列でも保存）
 * - globalNote: 全体コメント
 * - savedAt: 保存時刻（ISO 8601）
 *
 * 旧 schemaVersion 1 (workingMd 形式) は plan18 で廃止＝
 * main 側で IntegrityError throw（移行ロジックなし・owner 検証段階・design §4-4）。
 */
export interface AutosaveEntry {
  version: 2;
  basePath: string;
  baseOriginal: string;
  baseStat: BaseStat;
  baseRaw: string;
  operations: Operations;
  redoStack: Operations;
  globalNote: string;
  savedAt: string; // ISO 8601
  annotations?: import("./review-model/types.js").ReviewAnnotation[];
}

/** read-file の result 型（allowlist 不合格・fs エラーとも throw でなく error で返す） */
export type ReadFileResult =
  | { status: "ok"; path: string; content: string; stat: BaseStat }
  | { status: "error"; message: string };

/** autosave write/remove の result 型（write.ts と同じパターン＝fire-and-forget にしない） */
export type AutosaveOpResult =
  | { status: "ok" }
  | { status: "error"; message: string };
/** autosave read（ENOENT＝entry:null・破損/その他エラーは error） */
export type AutosaveReadResult =
  | { status: "ok"; entry: AutosaveEntry | null }
  | { status: "error"; message: string };
/** autosave list（corrupted＝破損で一覧から外した件数。renderer がバナーで可視化） */
export type AutosaveListResult =
  | {
      status: "ok";
      items: Array<{ basePath: string; savedAt: string }>;
      corrupted: number;
    }
  | { status: "error"; message: string };

export interface ShortcutSettings {
  version: 1;
  bindings: Record<string, string>;
}

/** K7: アプリ設定（文字サイズ等・shortcuts.json と別ファイルで管理） */
export interface AkapenSettings {
  version: 1;
  /** 文字サイズ（%）。50〜200 の整数。既定 100 */
  fontSize: number;
}

export interface AkapenBridge {
  openDialog(): Promise<{
    path: string;
    content: string;
    stat: BaseStat;
  } | null>;
  readFile(path: string): Promise<ReadFileResult>;
  writeReview(req: { basePath: string; content: string }): Promise<
    | { status: "saved"; path: string }
    | { status: "cancelled" }
    | { status: "error"; message: string } // main 側で fs エラーを正規化（throw で返さない）
  >;
  /** G6: 名前をつけて保存。renderer はコンテンツだけ渡す＝パス指定不可（main の dialog に委譲） */
  saveReviewAs(req: {
    content: string;
  }): Promise<
    | { status: "saved"; path: string }
    | { status: "cancelled" }
    | { status: "error"; message: string }
  >;
  confirm(req: { message: string; detail?: string }): Promise<boolean>;
  choose(req: {
    message: string;
    detail?: string;
    buttons: string[];
    cancelId?: number;
  }): Promise<number>; // 3択（base 不一致復元）・cancelId=Esc時に返す index（省略時は Electron 既定）
  showError(req: { message: string; detail?: string }): Promise<void>;
  autosave: {
    write(entry: AutosaveEntry): Promise<AutosaveOpResult>;
    read(basePath: string): Promise<AutosaveReadResult>;
    list(): Promise<AutosaveListResult>;
    remove(basePath: string): Promise<AutosaveOpResult>;
  };
  readShortcuts(): Promise<ShortcutSettings>;
  writeShortcuts(settings: ShortcutSettings): Promise<AutosaveOpResult>;
  /** K7: アプリ設定の読み書き */
  readSettings(): Promise<AkapenSettings>;
  writeSettings(settings: AkapenSettings): Promise<AutosaveOpResult>;
  /**
   * D&D 用。preload 内で webUtils.getPathForFile（実 File からのみパスを得られる）→
   * main の allowlist へ登録（akapen:register-drop）してからパスを返す。
   * renderer に「任意文字列を登録する」入口を公開しない＝allowlist の意味を保つ。
   */
  getPathForFile(file: File): Promise<string>;
  onOpenFile(
    cb: (p: { path: string; content: string; stat: BaseStat }) => void,
  ): () => void; // 戻り値＝購読解除関数
  onBaseChanged(cb: (p: { path: string }) => void): () => void; // 同上
  // K8: メニューからのファイル操作（main → renderer push）
  onMenuOpen(cb: () => void): () => void;
  onMenuSave(cb: () => void): () => void;
  onMenuSaveAs(cb: () => void): () => void;
  /** K7: メニューからの文字サイズ操作（main → renderer push） */
  onMenuFontSize(cb: (delta: number) => void): () => void;
  /** K7: メニューから設定パネルを開く（main → renderer push） */
  onMenuOpenSettings(cb: () => void): () => void;
}

declare global {
  interface Window {
    /** preload（contextBridge）が公開するブリッジ実体（Task 6 で配線） */
    akapen: AkapenBridge;
  }
}
