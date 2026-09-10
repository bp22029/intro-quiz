// 投影画面の大きな文字を、枠に収まる大きさへ落とす。
//
// 日本語は単語の途中でも改行される。「タマシイレボリューション」は
// 「タマシイレボ / リューション」のように割れるし、CSS の word-break や
// text-wrap では読める位置を選べない（keep-all にすると今度ははみ出す）。
// 改行位置を賢くしようとするより、1行に収まるまで縮めるほうが確実で、
// 遠くから読む投影画面では見栄えもよい。放送のテロップと同じ考え方。

/**
 * 見た目の幅を em 単位で数える。
 * 日本語のフォントは全角1文字がちょうど 1em、半角英数はおよそ 0.5em。
 * 厳密な字幅は測らない。ここは「収まるか」の見積もりなので、
 * 少なめに見えるほうへ倒しても実害がない。
 */
export function visualWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    // 半角の英数記号と半角カナ
    w += /[ -~｡-ﾟ]/.test(ch) ? 0.5 : 1;
  }
  return w;
}

/**
 * 投影画面の右側で、文字に使える幅（vw）。
 *
 * サイドバーは w-[25vw] min-w-[280px] max-w-[440px]、本文は px-10。
 * 実測すると 1024幅で 64.8vw、1280幅で 68.8vw、1920幅で 72.9vw になる。
 * いちばん狭いところに合わせておけば、どの解像度でもはみ出さない。
 */
const AVAILABLE_VW = 64;

/** これ以下には縮めない。ここまで来たら縮めるより2行に割るほうが読める */
const MIN_VW = 2.9;

export type Fit = {
  /** 文字の大きさ（vw） */
  sizeVw: number;
  /** 1行に収まるか。収まるなら折り返しを禁止して割れ方の事故を防ぐ */
  nowrap: boolean;
};

/**
 * text を maxVw 以下の大きさで、できれば1行に収める。
 * 1行にすると MIN_VW を下回るほど長い場合だけ、2行ぶんの幅で計算し直す。
 */
export function fitVw(text: string, maxVw: number): Fit {
  const w = visualWidth(text.trim());
  if (w <= 0) return { sizeVw: maxVw, nowrap: true };

  const oneLine = AVAILABLE_VW / w;
  if (oneLine >= MIN_VW) {
    return { sizeVw: Math.min(maxVw, oneLine), nowrap: true };
  }
  // 1行では小さくなりすぎる。2行に割ってそのぶん大きさを戻す。
  // ここまで長い曲名は稀で、割れ方の見栄えより読めることを優先する。
  return { sizeVw: Math.min(maxVw, (AVAILABLE_VW * 2) / w), nowrap: false };
}
