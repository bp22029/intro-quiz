// 貼り付けられた JSON を曲リストにする処理の検証。
// 実装をそのまま import するので、tsx で実行する:
//   npx tsx scripts/importtest.ts
// サーバーは不要。
import { parseSongsJson } from "../src/HostView";

let ng = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      ${detail}`}`);
  if (!ok) ng++;
}

function ok(label: string, text: string, expect: (songs: ReturnType<typeof parseSongsJson>) => boolean) {
  const r = parseSongsJson(text);
  check(label, r.ok && expect(r), JSON.stringify(r));
}

function ng2(label: string, text: string) {
  const r = parseSongsJson(text);
  check(label, !r.ok, JSON.stringify(r));
}

// --- 正常系 ---
ok(
  "書き出した形をそのまま読める",
  JSON.stringify([
    { videoId: "abc12345678", title: "曲A", artist: "A", owner: "推した人", startSec: 3, chorusSec: 40, volume: 55 },
  ]),
  (r) => r.ok && r.songs.length === 1 && r.songs[0].chorusSec === 40 && r.songs[0].volume === 55,
);

ok(
  "最小限の項目だけでも読める",
  '[{"videoId":"abc12345678","title":"曲A"}]',
  (r) => r.ok && r.songs[0].artist === "" && r.songs[0].startSec === 0,
);

ok(
  "chorusSec と volume が無ければ未設定のまま",
  '[{"videoId":"abc12345678","title":"曲A"}]',
  (r) => r.ok && r.songs[0].chorusSec === undefined && r.songs[0].volume === undefined,
);

ok(
  "負の秒数は0に丸める",
  '[{"videoId":"abc12345678","title":"曲A","startSec":-5,"chorusSec":-9}]',
  (r) => r.ok && r.songs[0].startSec === 0 && r.songs[0].chorusSec === 0,
);

ok(
  "空の行は捨てて有効な行だけ残す",
  '[{"title":""},{"videoId":""},{"videoId":"abc12345678","title":"有効"}]',
  (r) => r.ok && r.songs.length === 1 && r.songs[0].title === "有効",
);

ok(
  "前後の空白を落とす",
  '[{"videoId":" abc12345678 ","title":"  曲A  ","artist":" A "}]',
  (r) => r.ok && r.songs[0].videoId === "abc12345678" && r.songs[0].title === "曲A" && r.songs[0].artist === "A",
);

ok(
  "曲名だけでも1曲として扱う（動画IDは後から入れられる）",
  '[{"title":"あとで動画IDを入れる"}]',
  (r) => r.ok && r.songs.length === 1 && r.songs[0].videoId === "",
);

// --- 異常系 ---
ng2("JSONとして壊れている", "[{videoId: 'abc'}]");
ng2("末尾のカンマ", '[{"title":"A"},]');
ng2("配列ではない", '{"videoId":"abc12345678","title":"曲A"}');
ng2("空配列", "[]");
ng2("空文字", "");
ng2("中身が空の行だけ", '[{},{"title":""}]');
ng2("数値の配列", "[1,2,3]");

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
