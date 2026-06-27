import { diffArrays } from 'diff';
import { graphemes } from './graphemes.js';
import { normalizeNodes } from './normalize.js';
import { parseCritic } from './parse.js';
import { serializeCritic } from './serialize.js';
import { acceptView, rejectView } from './views.js';
import type { MarkupNode, NodeKind } from './types.js';

export class IntegrityError extends Error {
  override readonly name = 'IntegrityError';
}

// エディター現在本文(working: 削除/コメントはマーク済・追記はプレーン)と
// 元原稿(base)を突き合わせ、追記を {++…++} 化し、マーク無しで消えた本文を
// {--…--} として復元した CriticMarkup 文字列を返す。
// 差分は書記素（見た目の1文字）単位＝絵文字修飾子・結合文字を分断しない。
export function reconcile(base: string, working: string): string {
  const nodes = parseCritic(working);

  // 「全提案を却下した姿」に寄与する書記素列（text/deletion/highlight の中身）。
  // comment/insertion は寄与しない＝何書記素目の直後に居たかだけ覚える
  const contribKind: NodeKind[] = [];
  const contribSeg: string[] = [];
  const anchored: { at: number; node: MarkupNode }[] = [];
  for (const n of nodes) {
    if (n.kind === 'comment' || n.kind === 'insertion') {
      anchored.push({ at: contribSeg.length, node: n });
    } else {
      for (const seg of graphemes(n.text)) {
        contribKind.push(n.kind);
        contribSeg.push(seg);
      }
    }
  }

  const outNodes: MarkupNode[] = [];
  let run = '';
  let runKind: NodeKind | null = null;
  const flushRun = (): void => {
    if (runKind !== null && run !== '') outNodes.push({ kind: runKind, text: run });
    run = '';
    runKind = null;
  };
  const emit = (kind: NodeKind, seg: string): void => {
    if (runKind !== kind) {
      flushRun();
      runKind = kind;
    }
    run += seg;
  };

  let p = 0; // contribSeg 上の消費位置
  let a = 0; // anchored の消費位置
  const flushAnchors = (): void => {
    while (a < anchored.length && (anchored[a]?.at ?? Infinity) <= p) {
      flushRun();
      outNodes.push(anchored[a]!.node);
      a++;
    }
  };

  for (const part of diffArrays(graphemes(base), contribSeg)) {
    if (part.removed) {
      // base にあって作業本文から（マーク無しで）消えた書記素 → 削除として復元
      flushAnchors();
      for (const seg of part.value) emit('deletion', seg);
    } else {
      const added = part.added === true;
      for (const seg of part.value) {
        flushAnchors();
        const kind = contribKind[p] ?? 'text';
        // 追記された書記素は、元が地の文なら insertion 化。マーク内は種別を保つ
        emit(added && kind === 'text' ? 'insertion' : kind, seg);
        p++;
      }
    }
  }
  flushAnchors();
  flushRun();

  const result = serializeCritic(normalizeNodes(outNodes));

  // 整合性自己検査（沈黙故障防止）: 書き出し文字列を読み戻して
  // 「全却下＝base」「全採用＝編集後の見た目」が成り立たなければ保存させない
  const reparsed = parseCritic(result);
  if (
    rejectView(reparsed) !== base ||
    acceptView(reparsed) !== acceptView(nodes)
  ) {
    throw new IntegrityError(
      '添削結果の整合性検査に失敗しました。考えられる原因: ①本文に記法と衝突する文字列（++} や --} など）が含まれている ②元原稿に存在しないテキストが削除マークで囲まれている。',
    );
  }
  return result;
}
