/**
 * S1 機構(i) を Milkdown に載せるための remark プラグイン。
 *
 * 由来: `spikes/k35-spike/format-view-spike/src/critic-remark-syntax.ts`（33 行）。
 *
 * 現行 critic.ts の criticRemark は「mdast transform（text を後割り）」だが、それだと
 * `{++**++}` の `**` が emphasis に先食いされる（spike の決定的発見＝plan5 §S1）。
 * このプラグインは parse 経路を **micromark 構文拡張＋from-markdown 拡張** に差し替える＝
 * `{++…++}` を inline atomic トークンとして emphasis より前に消費する。
 *
 * unified の標準口（this.data）に登録する:
 *   - micromarkExtensions   ← criticMicromark()（構文＝トークン化）
 *   - fromMarkdownExtensions ← criticMdast()（mdast ノード化）
 * stringify（mdast→md）は現行 critic.ts の toMarkdownExtensions（criticRemark 内）を
 * そのまま使う＝本プラグインは parse だけを上書きする（transform は二重でも text に
 * critic が残らないので無害＝spike §6-5・plan8 §6 D3 判定で段階3 ではここで整理しない）。
 */
import { $remark } from '@milkdown/kit/utils';
import type { RemarkPluginRaw } from '@milkdown/kit/transformer';
import { criticMdast, criticMicromark } from './critic-micromark';

function remarkCriticSyntax(this: { data: () => Record<string, unknown> }) {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
  };
  (data.micromarkExtensions ??= []).push(criticMicromark());
  (data.fromMarkdownExtensions ??= []).push(criticMdast());
  // transform は不要（parse 段で mdast ノードが既に出来ている）。
}

export const criticRemarkSyntax = $remark(
  'criticRemarkSyntax',
  () => remarkCriticSyntax as unknown as RemarkPluginRaw<unknown>,
);
