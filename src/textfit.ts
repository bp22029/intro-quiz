// 投影画面の大きな文字を、枠に収まる大きさへ落とす。
//
// 日本語は単語の途中でも改行される。「タマシイレボリューション」は
// 「タマシイレボ / リューション」のように割れるし、CSS の word-break や
// text-wrap では読める位置を選べない（keep-all にすると今度ははみ出す）。
// 改行位置を賢くしようとするより、1行に収まるまで縮めるほうが確実で、
// 遠くから読む投影画面では見栄えもよい。放送のテロップと同じ考え方。

/**
 * 見た目の幅を em 単位で数える（実測できないときの見積もり）。
 * 日本語のフォントは全角1文字がちょうど 1em、半角英数はおよそ 0.5em。
 * 半角を一律 0.5em と数えるので、`i` や `l` や空白の多い英語のタイトルは
 * 実際より広く見積もられ、必要より小さい文字になる。ブラウザでは
 * measuredWidth() が本物のフォントで測るので、こちらは node での検証と、
 * canvas が使えない環境のための保険。
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

// 投影画面のフォント（Zen Kaku Gothic New）は半角英数がプロポーショナルで、
// `W` と `i` では幅がまるで違う。見積もりだと英語のタイトルが小さくなりすぎるので、
// 出せる環境では canvas に測らせる。index.css / tailwind.config.js と同じ並び。
const FAMILY =
  '"Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const BASE_PX = 100;

/** canvas は使い回す。1文字ごとに作ると投影画面が重くなる。null は「使えない」 */
let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * 本物のフォントで幅を em 単位で測る。100px で測って割れば em になる。
 * 測れなければ null（node、canvas が使えない環境）。呼ぶ側は見積もりへ落ちる。
 */
export function measuredWidth(
  text: string,
  weight: number,
  tracking: number,
): number | null {
  if (typeof document === "undefined") return null;
  if (ctx === undefined) {
    try {
      ctx = document.createElement("canvas").getContext("2d");
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return null;
  ctx.font = `${weight} ${BASE_PX}px ${FAMILY}`;
  const w = ctx.measureText(text).width / BASE_PX;
  if (!(w > 0)) return null;
  // letter-spacing は measureText に乗らないので足す
  return w + tracking * [...text].length;
}

/** 測るときの字面。要素の font-weight / tracking と合わせること */
export type FitStyle = {
  /** font-black = 900、font-medium = 500 */
  weight?: number;
  /** tracking-[0.02em] なら 0.02 */
  tracking?: number;
};

export type Fit = {
  /** 文字の大きさ（vw） */
  sizeVw: number;
  /** 1行に収まるか。収まるなら折り返しを禁止して割れ方の事故を防ぐ */
  nowrap: boolean;
};

/**
 * text を maxVw 以下の大きさで、できれば1行に収める。
 * 1行にすると MIN_VW を下回るほど長い場合だけ、2行ぶんの幅で計算し直す。
 *
 * style は測るときの字面。ブラウザではこれで実測し、測れなければ見積もりを使う。
 * フォントが後から載ると幅が変わるので、呼ぶ側は useFontsReady() で測り直すこと。
 */
export function fitVw(text: string, maxVw: number, style: FitStyle = {}): Fit {
  const t = text.trim();
  const w =
    measuredWidth(t, style.weight ?? 400, style.tracking ?? 0) ?? visualWidth(t);
  if (w <= 0) return { sizeVw: maxVw, nowrap: true };

  const oneLine = AVAILABLE_VW / w;
  if (oneLine >= MIN_VW) {
    return { sizeVw: Math.min(maxVw, oneLine), nowrap: true };
  }
  // 1行では小さくなりすぎる。2行に割ってそのぶん大きさを戻す。
  // ここまで長い曲名は稀で、割れ方の見栄えより読めることを優先する。
  return { sizeVw: Math.min(maxVw, (AVAILABLE_VW * 2) / w), nowrap: false };
}
