// YouTube URL から動画IDと再生開始位置を取り出すロジックの検証。
// 実装をそのまま import するので、tsx で実行する（node では .ts を読めない）:
//   npx tsx scripts/urltest.ts
// サーバーは不要（通信しない）。
import { parseYouTube, ytUrl } from "../src/yturl";

const fail: string[] = [];
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`      期待: ${JSON.stringify(want)}`);
    console.log(`      実際: ${JSON.stringify(got)}`);
    fail.push(label);
  }
}

// --- 動画IDの抽出 ---
eq("通常URL", parseYouTube("https://www.youtube.com/watch?v=n0K_BdpFuDY"), {
  videoId: "n0K_BdpFuDY",
  t: null,
});
eq("短縮URL", parseYouTube("https://youtu.be/n0K_BdpFuDY"), {
  videoId: "n0K_BdpFuDY",
  t: null,
});
eq("埋め込みURL", parseYouTube("https://www.youtube.com/embed/n0K_BdpFuDY"), {
  videoId: "n0K_BdpFuDY",
  t: null,
});
eq("IDだけ貼った場合", parseYouTube("n0K_BdpFuDY"), {
  videoId: "n0K_BdpFuDY",
  t: null,
});
eq("前後に空白", parseYouTube("  n0K_BdpFuDY  "), {
  videoId: "n0K_BdpFuDY",
  t: null,
});

// --- 開始位置つき ---
eq("短縮URL + t=66", parseYouTube("https://youtu.be/n0K_BdpFuDY?t=66"), {
  videoId: "n0K_BdpFuDY",
  t: 66,
});
eq("通常URL + t=66s", parseYouTube("https://www.youtube.com/watch?v=abc12345&t=66s"), {
  videoId: "abc12345",
  t: 66,
});
eq("t=1m6s 形式", parseYouTube("https://youtu.be/abc12345?t=1m6s"), {
  videoId: "abc12345",
  t: 66,
});
eq("t=2h3m4s 形式", parseYouTube("https://youtu.be/abc12345?t=2h3m4s"), {
  videoId: "abc12345",
  t: 7384,
});
eq("embed の start=", parseYouTube("https://www.youtube.com/embed/abc12345?start=90"), {
  videoId: "abc12345",
  t: 90,
});
eq(
  "共有リンクの si= が混ざる形",
  parseYouTube("https://youtu.be/n0K_BdpFuDY?si=NwvmT7SJSioDif-G&t=66"),
  { videoId: "n0K_BdpFuDY", t: 66 },
);
eq(
  "パラメータ順が逆",
  parseYouTube("https://www.youtube.com/watch?t=120&v=abc12345"),
  { videoId: "abc12345", t: 120 },
);

// --- URL生成 ---
eq("URL生成", ytUrl("abc12345", 66), "https://www.youtube.com/watch?v=abc12345&t=66s&autoplay=1");
eq("小数は切り捨て", ytUrl("abc12345", 66.9), "https://www.youtube.com/watch?v=abc12345&t=66s&autoplay=1");
eq("負の秒は0", ytUrl("abc12345", -10), "https://www.youtube.com/watch?v=abc12345&t=0s&autoplay=1");

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
process.exit(fail.length ? 1 : 0);
