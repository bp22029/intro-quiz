// 投影画面の大きな文字を枠に収める計算の検証。
// 日本語は単語の途中で改行されるので、ここが狂うと曲名が
// 「タマシイレボ / リューション」のように割れるか、枠からはみ出す。
// 実装をそのまま import するので、tsx で実行する:
//   npx tsx scripts/fittest.ts
// サーバーは不要。
import { fitVw, measuredWidth, visualWidth } from "../src/textfit";

let ng = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      ${detail}`}`);
  if (!ok) ng++;
}

// --- 見た目の幅 ---
function width(label: string, text: string, want: number) {
  const got = visualWidth(text);
  check(`${label}（${want}em）`, got === want, `得: ${got}`);
}
width("全角は1文字1em", "天体観測", 4);
width("カタカナも1em", "タマシイレボリューション", 12);
width("半角英数は0.5em", "Superfly", 4);
width("半角スペースも0.5em", "One Ok", 3);
width("混在", "AIZO・愛憎", 5); // A I Z O = 2 / ・愛憎 = 3
width("空文字", "", 0);

// --- 収まり方 ---
// 使える幅は 64vw（サイドバーと余白を引いた、いちばん狭い解像度に合わせた値）
const AVAIL = 64;

function fits(label: string, text: string, maxVw: number) {
  const f = fitVw(text, maxVw);
  const used = visualWidth(text) * f.sizeVw;
  const lines = f.nowrap ? 1 : 2;
  check(
    label,
    f.sizeVw <= maxVw + 1e-9 && used <= AVAIL * lines + 1e-9,
    `size=${f.sizeVw.toFixed(2)}vw nowrap=${f.nowrap} 使用幅=${used.toFixed(1)}vw / ${AVAIL * lines}vw`,
  );
}

// 実際に使った曲名で、はみ出さないこと
for (const t of [
  "天体観測",
  "リライト",
  "完全感覚Dreamer",
  "タマシイレボリューション",
  "帰り道は遠回りしたくなる",
  "島唄 (オリジナル・ヴァージョン)",
  "Invisible Man (Adult Version)",
]) {
  fits(`曲名がはみ出さない: ${t}`, t, 7.8);
}

// 参加者名はサーバーが12文字で切る。その上限でも収まること
fits("回答者名の上限（全角12文字）", "あいうえおかきくけこさし", 11.7);
fits("回答者名が短いとき", "あおい", 11.7);
fits("アーティスト名が長いとき", "ASIAN KUNG-FU GENERATION", 3);

// --- 大きさの決まり方 ---
check(
  "短い曲名は上限の大きさのまま",
  fitVw("天体観測", 7.8).sizeVw === 7.8,
  JSON.stringify(fitVw("天体観測", 7.8)),
);
check(
  "長い曲名は縮む",
  fitVw("タマシイレボリューション", 7.8).sizeVw < 7.8,
  JSON.stringify(fitVw("タマシイレボリューション", 7.8)),
);
check(
  "縮めれば1行に収まるものは折り返さない",
  fitVw("タマシイレボリューション", 7.8).nowrap === true,
);
check(
  "12文字の曲名は同じ大きさになる（かなでもカタカナでも）",
  fitVw("タマシイレボリューション", 7.8).sizeVw ===
    fitVw("帰り道は遠回りしたくなる", 7.8).sizeVw,
);

// 極端に長いものは、縮めきらずに2行へ落とす
const veryLong = "あ".repeat(30);
check(
  "30文字は2行に落とす",
  fitVw(veryLong, 7.8).nowrap === false,
  JSON.stringify(fitVw(veryLong, 7.8)),
);
check(
  "2行に落としたぶん大きさは戻る",
  fitVw(veryLong, 7.8).sizeVw > AVAIL / 30,
  JSON.stringify(fitVw(veryLong, 7.8)),
);
check("空でも落ちない", fitVw("", 7.8).sizeVw === 7.8);

// --- 実測の経路 ---
// ブラウザでは canvas に幅を測らせる（半角を一律0.5emで数えると、英語の
// タイトルが小さくなりすぎるため）。node には canvas が無いので、
// 見積もりへ落ちること と 測れる場合の使い方 の両方をここで見る。
check(
  "canvas が無ければ見積もりに落ちる",
  measuredWidth("Superfly", 900, 0.02) === null,
  `得: ${measuredWidth("Superfly", 900, 0.02)}`,
);
check(
  "字面を渡しても見積もりの結果は変わらない",
  fitVw("Invisible Man", 7.8).sizeVw === fitVw("Invisible Man", 7.8, { weight: 900 }).sizeVw,
);

// 100px で測った幅を em に直し、letter-spacing を足していること。
// document を差し替えて、1文字60pxを返す canvas を持たせる。
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({
    getContext: () => ({
      font: "",
      measureText: (t: string) => ({ width: t.length * 60 }),
    }),
  }),
};
const measured = measuredWidth("abcde", 900, 0.02);
check(
  "測れるときは 100px 基準の em + tracking",
  measured !== null && Math.abs(measured - (5 * 60) / 100 - 5 * 0.02) < 1e-9,
  `得: ${measured}`,
);
check(
  "測れるときは見積もりより実測が優先される",
  // 見積もりなら 5 * 0.5 = 2.5em → 64/2.5 = 25.6vw。実測は 3.1em → 20.6vw
  Math.abs(fitVw("abcde", 30, { weight: 900, tracking: 0.02 }).sizeVw - 64 / 3.1) < 1e-6,
  JSON.stringify(fitVw("abcde", 30, { weight: 900, tracking: 0.02 })),
);

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
