// 管理画面からの曲リスト編集が、投影画面・参加者へ正しく配られるかを検証する。
//   node scripts/songstest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 250);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

function conn() {
  const s = io(URL, { transports: ["websocket"] });
  s.lastState = null;
  s.on("state", (st) => (s.lastState = st));
  // 曲データは投影画面と管理画面にだけ配られるので、役割を名乗る
  return new Promise((res) =>
    s.on("connect", () => {
      s.emit("role:host");
      res(s);
    }),
  );
}

const screen = await conn();
const host = await conn();
await wait(D);

const original = screen.lastState.songs;
check("投影画面に曲リストが届いている", Array.isArray(original));

const three = [
  { videoId: "aaa11", title: "曲A", artist: "アA", owner: "太郎", startSec: 1, chorusSec: 40 },
  { videoId: "bbb22", title: "曲B", artist: "アB", owner: "花子", startSec: 2, chorusSec: 50 },
  { videoId: "ccc33", title: "曲C", artist: "アC", owner: "次郎", startSec: 3, chorusSec: 60 },
];

host.emit("host:setSongs", three);
await wait(D);
check("曲リストの差し替えが配信される", screen.lastState.songs.length === 3);
check("曲名が反映される", screen.lastState.songs[0].title === "曲A");
check("推した人が反映される", screen.lastState.songs[1].owner === "花子");
check("サビ秒が反映される", screen.lastState.songs[2].chorusSec === 60);

// 並べ替え（管理画面は配列の順序を入れ替えて送る）
const swapped = [three[2], three[0], three[1]];
host.emit("host:setSongs", swapped);
await wait(D);
check("並べ替えが反映される", screen.lastState.songs[0].title === "曲C");
check("並べ替え後も件数は同じ", screen.lastState.songs.length === 3);

// 追加
host.emit("host:setSongs", [...swapped, { videoId: "ddd44", title: "曲D", artist: "", owner: "", startSec: 0 }]);
await wait(D);
check("曲の追加が反映される", screen.lastState.songs.length === 4);
check("未入力欄は空文字で保持される", screen.lastState.songs[3].artist === "");

// 現在位置が範囲外になる削除
host.emit("host:setSong", 3);
await wait(D);
check("第4問に移動できる", screen.lastState.round.index === 3);
host.emit("host:setSongs", [swapped[0]]);
await wait(D);
check("曲を減らすと現在位置が丸められる", screen.lastState.round.index === 0);

// 不正な入力
host.emit("host:setSongs", "not-an-array");
await wait(D);
check("配列でない入力を無視する", screen.lastState.songs.length === 1);

host.emit("host:setSongs", [{ title: "" }, { videoId: "" }, { title: "有効な曲" }]);
await wait(D);
check("空の行は捨てられる", screen.lastState.songs.length === 1);
check("有効な行だけ残る", screen.lastState.songs[0].title === "有効な曲");

host.emit("host:setSongs", [{ title: "長さテスト", startSec: -5, chorusSec: "abc" }]);
await wait(D);
check("負の秒数は0に丸められる", screen.lastState.songs[0].startSec === 0);
check("数値でないサビ秒は0に丸められる", screen.lastState.songs[0].chorusSec === 0);

// 8曲まで扱えるか（当日の想定曲数）
const eight = Array.from({ length: 8 }, (_, i) => ({
  videoId: `vid${i}0000`,
  title: `第${i + 1}曲`,
  artist: `アーティスト${i + 1}`,
  owner: `提供者${i + 1}`,
  startSec: i,
  chorusSec: 30 + i,
}));
host.emit("host:setSongs", eight);
await wait(D);
check("8曲を登録できる", screen.lastState.songs.length === 8);
check("8曲目の内容が正しい", screen.lastState.songs[7].title === "第8曲");
check("8曲目のサビ秒が正しい", screen.lastState.songs[7].chorusSec === 37);

host.emit("host:setSong", 7);
await wait(D);
check("8問目まで進める", screen.lastState.round.index === 7);
host.emit("host:setSong", 0);
await wait(D);

// 曲ごとの音量。YouTube の正規化は大きい音を下げるだけなので、
// アートトラックとMVを混ぜたときの差を曲ごとに埋められる必要がある。
host.emit("host:setSongs", [
  { videoId: "vol00001", title: "音量つき", startSec: 0, volume: 40 },
  { videoId: "vol00002", title: "音量なし", startSec: 0 },
  { videoId: "vol00003", title: "範囲外", startSec: 0, volume: 500 },
  { videoId: "vol00004", title: "負の値", startSec: 0, volume: -20 },
  { videoId: "vol00005", title: "数値でない", startSec: 0, volume: "abc" },
]);
await wait(D);
check("音量が保存される", screen.lastState.songs[0].volume === 40);
check(
  "未指定の音量は undefined のまま（全体音量に従う）",
  screen.lastState.songs[1].volume === undefined,
);
check("100を超える音量は100に丸められる", screen.lastState.songs[2].volume === 100);
check("負の音量は0に丸められる", screen.lastState.songs[3].volume === 0);
check("数値でない音量は0に丸められる", screen.lastState.songs[4].volume === 0);

// 全体音量。曲ごとに設定していない曲はこの値で鳴るので、
// 「1曲ずつ触らないと下がらない」状態にならないことを確かめる。
check("全体音量の既定は100ではない", screen.lastState.masterVolume === 70);

host.emit("host:setMasterVolume", 35);
await wait(D);
check("全体音量が反映される", screen.lastState.masterVolume === 35);

host.emit("host:setMasterVolume", 500);
await wait(D);
check("100を超える全体音量は100に丸められる", screen.lastState.masterVolume === 100);

host.emit("host:setMasterVolume", -10);
await wait(D);
check("負の全体音量は0に丸められる", screen.lastState.masterVolume === 0);

host.emit("host:setMasterVolume", "abc");
await wait(D);
check("数値でない全体音量は無視される", screen.lastState.masterVolume === 0);

host.emit("host:setMasterVolume", 70); // 既定へ戻す
await wait(D);
check("全体音量を戻せる", screen.lastState.masterVolume === 70);

// 曲ごとの設定を消すと、全体音量に戻る（管理画面の「全体に戻す」相当）
host.emit("host:setSongs", [
  { videoId: "ovr00001", title: "上書きあり", startSec: 0, volume: 20 },
]);
await wait(D);
check("上書きが入る", screen.lastState.songs[0].volume === 20);
host.emit("host:setSongs", [
  { videoId: "ovr00001", title: "上書きあり", startSec: 0 },
]);
await wait(D);
check(
  "上書きを外すと未設定へ戻る（全体音量に従う）",
  screen.lastState.songs[0].volume === undefined,
);

// 後片付け: 元の曲リストへ戻す
host.emit("host:setSongs", original);
host.emit("host:setSong", 0);
await wait(D);
check("元の曲リストへ戻せる", screen.lastState.songs.length === original.length);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[screen, host].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
