// YouTube URL から動画IDと再生開始位置を取り出すロジックの検証。
// HostView.tsx の parseYouTube / ytUrl と同じ実装をここに写して検査する。
// （tsx を素の node で読めないため。ロジックを変えたら両方直すこと）
//   node scripts/urltest.mjs

function parseYouTube(input) {
  const v = input.trim();
  const idMatch =
    v.match(/[?&]v=([A-Za-z0-9_-]{5,})/) ??
    v.match(/youtu\.be\/([A-Za-z0-9_-]{5,})/) ??
    v.match(/\/embed\/([A-Za-z0-9_-]{5,})/);
  const videoId = (idMatch ? idMatch[1] : v).slice(0, 40);

  const tMatch = v.match(/[?&](?:t|start)=([0-9hms]+)/i);
  let t = null;
  if (tMatch) {
    const raw = tMatch[1];
    if (/^\d+$/.test(raw)) {
      t = Number(raw);
    } else {
      const h = Number(raw.match(/(\d+)h/)?.[1] ?? 0);
      const m = Number(raw.match(/(\d+)m/)?.[1] ?? 0);
      const sec = Number(raw.match(/(\d+)s/)?.[1] ?? 0);
      t = h * 3600 + m * 60 + sec;
    }
  }
  return { videoId, t };
}

function ytUrl(videoId, sec) {
  const t = Math.max(0, Math.floor(sec));
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s&autoplay=1`;
}

const fail = [];
function eq(label, got, want) {
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
