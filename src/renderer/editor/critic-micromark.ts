/**
 * S1 機構(i): critic 記法を micromark 構文拡張で「inline の atomic トークン」として食う。
 *
 * 由来: `spikes/k35-spike/format-view-spike/src/critic-micromark.ts`（158 行・S1 6 件＋S2 7 件 PASS×2）。
 *
 * なぜ必要か（spike の決定的発見＝plan5 §S1）:
 *   現行 criticRemark（critic.ts）は mdast の text ノードを後段で割る transform。
 *   だが `{++**++}重要{++**++}` の `**` は micromark の emphasis トークナイザが
 *   parse 時点で先に食い `<strong>` 化する（criticRemark が走る前）。結果 `{++`/`++}` が
 *   孤立テキストになり criticInsertion が付かない＝S1 のインライン太字表示が成立しない。
 *
 *   構文拡張なら emphasis より前に `{++…++}` を1トークンとして消費する＝中の `**` は
 *   emphasis トークナイザに届かない。これで `{++**++}` が criticInsertion(`**`) として
 *   そのまま残り、format-display の decoration（記号隠し＋効果）が効く。
 *
 * スコープ（spike 段階の最小到達点＝段階3 実装でもそのまま採用）:
 *   - 同一行インラインの4記法（{-- --}/{++ ++}/{>> <<}/{== ==}）。
 *   - 中身に閉じデリミタ・改行を含まない素朴版（A1=ネスト無しの前提と整合）。
 *   - mdast ノードは現行 critic.ts と同型: criticInsertion/criticDeletion/criticHighlight/criticComment
 *     ＋text 子1つ（既存マークスキーマがそのまま受ける＝view 層は無改修で乗る）。
 *
 * 段階3 での型付け（plan8 §2-3・spike §6-3）:
 *   `micromark-util-types` で `Extension`/`Effects`/`State`/`Tokenizer`/`Code` を厳密化。
 *   閉じデリミタ先頭文字（`+`/`-`/`<`/`=`/`>`）が本文中に単独で現れる場合の巻き戻しは
 *   spike と同じく nok に倒す簡易版（A1 と整合）。複数行マークも nok（EOL/EOF 検出で打ち切り）。
 */
import type { Nodes } from 'mdast';
import type {
  CompileContext,
  Extension as MdastExtension,
} from 'mdast-util-from-markdown';
import type { Code, Effects, Extension, State, Token, Tokenizer } from 'micromark-util-types';

// 段階3 では critic 用に独自トークン名（criticMark/criticMarkOpen/criticMarkBody/criticMarkClose）を
// 4つ追加する。`micromark-util-types` の TokenTypeMap は文字列リテラル union ＝
// module augmentation で拡張する（既存トークンには触れない・他拡張と衝突しない）。
declare module 'micromark-util-types' {
  interface TokenTypeMap {
    criticMark: 'criticMark';
    criticMarkOpen: 'criticMarkOpen';
    criticMarkBody: 'criticMarkBody';
    criticMarkClose: 'criticMarkClose';
  }
}

const OPEN_TO_KIND: Record<string, string> = {
  '{--': 'criticDeletion',
  '{++': 'criticInsertion',
  '{>>': 'criticComment',
  '{==': 'criticHighlight',
};
const KIND_TO_CLOSE: Record<string, string> = {
  criticDeletion: '--}',
  criticInsertion: '++}',
  criticComment: '<<}',
  criticHighlight: '==}',
};

// micromark codes
const LBRACE = 123; // {

/**
 * micromark 構文拡張（text コンストラクト）。`{` で起動し、開き3文字→本文→閉じ3文字を
 * 1つの criticMark トークンとして消費する。本文・閉じデリミタが揃わなければ nok で戻す。
 */
export function criticMicromark(): Extension {
  const tokenize: Tokenizer = function tokenize(
    this: unknown,
    effects: Effects,
    ok: State,
    nok: State,
  ): State {
    let openBuf = '';
    let kind: string | null = null;
    let closeStr = '';
    let closeIdx = 0;

    const start: State = (code: Code) => {
      if (code !== LBRACE) return nok(code);
      effects.enter('criticMark');
      effects.enter('criticMarkOpen');
      openBuf = '{';
      effects.consume(code);
      return openTwo;
    };
    const openTwo: State = (code: Code) => {
      if (code === null || code < 0) return nok(code);
      openBuf += String.fromCharCode(code);
      effects.consume(code);
      return openThree;
    };
    // HIGH-2（段階5）: openBuf への副作用を nok 判定より後に移す。
    // 旧実装は openBuf += … を先に書いてから nok を返すため、nok 後も openBuf が書き換わった
    // 状態で残る（1 tokenize = 1 呼び出しなので実害はないが、コードパターンとして誤解を生む）。
    // 仮計算（tentative）を使い、kind が確定してから openBuf を更新する順序に整理する。
    const openThree: State = (code: Code) => {
      if (code === null || code < 0) return nok(code);
      const tentative = openBuf + String.fromCharCode(code);
      kind = OPEN_TO_KIND[tentative] ?? null;
      if (!kind) return nok(code);
      openBuf = tentative;
      closeStr = KIND_TO_CLOSE[kind]!;
      effects.consume(code);
      effects.exit('criticMarkOpen');
      effects.enter('criticMarkBody');
      return body;
    };
    const body: State = (code: Code) => {
      // EOF / EOL（改行・行末）では成立させない（同一行版・A1 と整合）。
      if (code === null || code < 0) return nok(code);
      if (code === closeStr.charCodeAt(0)) {
        // 閉じデリミタ候補。effects.attempt で照合を試み、失敗なら本文の1文字として consume。
        // ─ 修正（M-11 対策）: 旧実装は tryClose 呼び出し時点で effects.exit/enter を発火していた
        //   ため、本文中に closeStr 先頭文字（+/-/=/</>）が現れると照合失敗後も
        //   criticMarkBody/criticMarkClose のトークンシーケンスが壊れ、パーサ全体が nok に倒れ
        //   Markdown fallback → 幽霊 strong 化（K3-8t-b で実証: TRUE_HIGH_NEST_BREAK）。
        //   effects.attempt を使えばバックトラック後に状態が完全に巻き戻り、
        //   失敗時は bodyFallback で普通の文字として consume → body 継続が安全にできる。
        return effects.attempt(closeTryConstruct, ok, bodyFallback)(code);
      }
      effects.consume(code);
      return body;
    };
    // bodyFallback: 閉じデリミタの試みが失敗した場合に、closeStr 先頭文字を本文の1文字として consume して body へ戻る。
    const bodyFallback: State = (code: Code) => {
      effects.consume(code);
      return body;
    };
    // closeTryConstruct: effects.attempt で使う sub-construct。
    // 照合成功時は exit('criticMarkBody') → enter/exit('criticMarkClose') → exit('criticMark') → ok。
    // 照合失敗時は effects.attempt が状態を完全に巻き戻し bodyFallback へ制御を移す。
    const closeTryConstruct = {
      tokenize: (
        _effects: Effects,
        innerOk: State,
        innerNok: State,
      ): State => {
        closeIdx = 0;
        // effects（outer）の exit/enter でトークン境界を作る。
        // ここは attempt 内なので失敗時は attempt が巻き戻すため安全。
        _effects.exit('criticMarkBody');
        _effects.enter('criticMarkClose');
        const step: State = (c: Code) => {
          if (c === null || c < 0) return innerNok(c);
          if (c === closeStr.charCodeAt(closeIdx)) {
            _effects.consume(c);
            closeIdx++;
            if (closeIdx >= closeStr.length) {
              _effects.exit('criticMarkClose');
              _effects.exit('criticMark');
              return innerOk;
            }
            return step;
          }
          return innerNok(c);
        };
        return step;
      },
      partial: true as const,
    };
    return start;
  } as Tokenizer;

  return { text: { [LBRACE]: { tokenize, name: 'critic' } } } as Extension;
}

/**
 * mdast-util 拡張: criticMark トークン列を criticInsertion 等の mdast ノードへ。
 *
 * plan12 移行（HIGH-3・2026-06-14）:
 *   旧実装は `exit.criticMark` で `this.stack[this.stack.length - 1].children.push(node)` を
 *   直接呼ぶ＝CompileContext の stack を直接いじる undocumented internal pattern。
 *   バージョン依存の懸念があり、`as unknown as MdastExtension` のダブルキャストと
 *   `this: any` の型逃げが必要だった。
 *
 *   公式 API（CompileContext.enter / exit）に置き換え:
 *     - enter.criticMark(token): 全 raw を sliceSerialize で取り、先頭 3 文字から kind を確定。
 *       criticInsertion 等の親ノードを `this.enter(node, token)` で stack に積む。
 *     - enter.criticMarkBody(token): text 子ノードを `this.enter(textNode, token)` で stack に積む。
 *     - exit.criticMarkBody(token): text の value を sliceSerialize で設定し `this.exit(token)` で pop。
 *     - exit.criticMark(token): 親を `this.exit(token)` で pop。
 *   これで stack/tokenStack/position の管理を mdast-util-from-markdown 本体に委ねる。
 *
 *   criticMarkOpen / criticMarkClose は handler 未登録＝
 *   mdast-util-from-markdown 本体が `own.call(handler, type)` で skip する（index.js:236）
 *   ＝tokenStack に積まれない＝ペアリングは criticMark / criticMarkBody だけで完結。
 */
export function criticMdast(): MdastExtension {
  return {
    enter: {
      criticMark(this: CompileContext, token: Token) {
        // 全 raw を取り、先頭 3 文字（開きデリミタ）から kind を確定する。
        // tokenize 段（criticMicromark）で 3 文字が OPEN_TO_KIND のキーであることは
        // 保証されている（criticMark token が成立するのは kind 確定後だけ）＝
        // 万一一致しなければ critic 拡張の internal invariant 違反＝throw で気付かせる。
        const raw = this.sliceSerialize(token);
        const open = raw.slice(0, 3);
        const kind = OPEN_TO_KIND[open];
        if (!kind) {
          throw new Error(
            `[criticMdast] unknown open delimiter ${JSON.stringify(open)} ` +
              `(raw=${JSON.stringify(raw)})`,
          );
        }
        // criticInsertion/criticDeletion/criticHighlight/criticComment は
        // mdast の標準型ではない＝独自型。`Nodes` union には含まれないため
        // `as Nodes` 1 ステップのキャストが残る（不可避）。
        // 旧: as unknown as Parameters<CompileContext['enter']>[0]（二段飛び・冗長）
        // 新: as Nodes（単一ステップ・Parameters<...>[0] は Nodes と同義のため等価）
        const node = { type: kind, children: [] };
        this.enter(node as Nodes, token);
      },
      criticMarkBody(this: CompileContext, token: Token) {
        // onenterdata 同型: 親の children に text を新規作成して積む。
        // value は exit.criticMarkBody で sliceSerialize で設定する。
        const textNode = { type: 'text', value: '' };
        this.enter(textNode as Nodes, token);
      },
    },
    exit: {
      criticMarkBody(this: CompileContext, token: Token) {
        // ハイブリッドパターン（enter/exit ペア + exit 前の value pre-read）:
        //   stack[-1] は直前の enter.criticMarkBody が積んだ textNode の保証
        //   （CompileContext.enter/exit のペア管理により token の積み順が一致する）。
        //   `this.exit(token)` で pop される前に value を書き込む必要があるため、
        //   先に sliceSerialize で本文を取り、value に代入してから exit する。
        //   公式 exit は tokenStack の型一致 assert（criticMarkBody = criticMarkBody）と
        //   position.end の設定を担う。
        const tail = this.stack[this.stack.length - 1] as { value: string };
        tail.value += this.sliceSerialize(token);
        this.exit(token);
      },
      criticMark(this: CompileContext, token: Token) {
        this.exit(token);
      },
    },
  };
}
