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
  return new Promise((res) => s.on("connect", () => res(s)));
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

// 後片付け: 元の曲リストへ戻す
host.emit("host:setSongs", original);
host.emit("host:setSong", 0);
await wait(D);
check("元の曲リストへ戻せる", screen.lastState.songs.length === original.length);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[screen, host].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
