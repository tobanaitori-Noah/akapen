/**
 * AppState — plan30 v5: PM doc が真実源。
 *
 * v5 では PM doc が単一の真実源。baseRaw はファイルオープン時の内容を保持。
 * derivedMd は後方互換のため残すが、v5 では baseRaw と同値。
 * operations は常に空配列。
 */
import type { TokenHit } from "@akapen/markup";
import type { BaseStat } from "./bridge";
import type { Operations } from "@akapen/shared";

export type ViewMode = "preview" | "source";

export interface AppState {
  basePath: string | null;
  baseOriginal: string;
  baseStat: BaseStat | null;
  baseRaw: string;
  operations: Operations;
  derivedMd: string;
  globalNote: string;
  viewMode: ViewMode;
  criticHits: TokenHit[];
  baseChangedExternally: boolean;
}

/**
 * derivedMd を baseRaw から更新する（v5: 単純代入）。
 * 後方互換のため関数として残す。
 */
export function refreshDerived(state: AppState): void {
  state.operations = [];
  state.derivedMd = state.baseRaw;
}
