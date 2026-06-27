/**
 * readFile IPC の開封済みパス allowlist（計画2 Task 6）。
 * - isAllowed＝「登録済み」かつ「拡張子 .md / .markdown（大文字小文字無視）」。
 * - dialog / D&D / open-file / argv / second-instance で開いたパスを main 側が register する
 *   ＝renderer から任意パス（/etc/hosts 等）を読めないことを仕様とする。
 * 純ロジック（fs 非依存）。
 */
const MD_EXT = /\.(md|markdown)$/i;

export interface PathAllowlist {
  register(p: string): void;
  isAllowed(p: string): boolean;
}

export function createPathAllowlist(): PathAllowlist {
  const registered = new Set<string>();
  return {
    register(p: string): void {
      registered.add(p);
    },
    isAllowed(p: string): boolean {
      return registered.has(p) && MD_EXT.test(p);
    },
  };
}
