const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// 書記素（見た目の1文字）単位のユーティリティ。reconcile/normalize/summary で共有し、
// サロゲートペア・絵文字修飾子・結合文字を分断しない。
export const graphemes = (s: string): string[] =>
  Array.from(segmenter.segment(s), (x) => x.segment);

export const graphemeCount = (s: string): number => {
  let c = 0;
  for (const _ of segmenter.segment(s)) c++;
  return c;
};

export const clipGraphemes = (s: string, n: number): string => {
  const segs = graphemes(s);
  return segs.length <= n ? s : segs.slice(0, n).join('') + '…';
};
