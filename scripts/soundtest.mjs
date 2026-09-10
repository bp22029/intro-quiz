// 再生窓(/sound)がサーバーと正しく噛み合うかを検証する。
// 期待: 曲データが配られ、準備状況が管理画面へ届き、窓を閉じたら未接続へ戻る。
//   node scripts/soundtest.mjs [url]
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const D = Number(process.env.D) || (URL.startsWith("https") ? 900 : 300);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ng = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) ng++;
}

function connect() {
  return io(URL, { transports: ["websocket"] });
}

/** 最新の state を持ち続けるクライアントを作る */
function watcher(sock) {
  const box = { state: null };
  sock.on("state", (s) => (box.state = s));
  return box;
}

const host = connect();
const hostState = watcher(host);
host.emit("role:host");

const player = connect(); // 参加者。答えが漏れていないかの確認用
const playerState = watcher(player);
player.emit("join", { name: "そら", clientId: "sound-test-1" });

await wait(D);

// --- 再生窓を繋ぐ ---
const sound = connect();
const soundState = watcher(sound);
sound.emit("role:sound");
await wait(D);

check("再生窓に曲データが配られる", Array.isArray(soundState.state?.songs));
check(
  "管理画面から見て再生窓が接続済みになる",
  hostState.state?.ytStatus?.connected === true,
);
check(
  "参加者には曲データが配られない",
  Array.isArray(playerState.state?.songs) &&
    playerState.state.songs.length === 0,
);

// --- 準備状況の報告 ---
const total = soundState.state?.songs?.length ?? 0;
sound.emit("sound:yt", { ready: false, readyCount: 1, total });
await wait(D);
check(
  "準備中の件数が管理画面へ届く",
  hostState.state?.ytStatus?.readyCount === 1 &&
    hostState.state?.ytStatus?.ready === false,
);

sound.emit("sound:yt", { ready: true, readyCount: total, total });
await wait(D);
check(
  "準備完了が管理画面へ届く",
  hostState.state?.ytStatus?.ready === true &&
    hostState.state?.ytStatus?.connected === true,
);

// --- 不正な報告を無視する ---
sound.emit("sound:yt", "こわれた値");
await wait(D);
check(
  "不正な準備状況を無視する",
  hostState.state?.ytStatus?.ready === true,
);

// --- 窓を閉じたら未接続へ戻る ---
sound.close();
await wait(D * 2);
check(
  "再生窓を閉じると未接続になる",
  hostState.state?.ytStatus?.connected === false,
);
check(
  "再生窓を閉じると準備完了も取り消される",
  hostState.state?.ytStatus?.ready === false &&
    hostState.state?.ytStatus?.readyCount === 0,
);

// --- 2つ開いて1つ閉じても接続は保たれる ---
const soundA = connect();
const soundB = connect();
soundA.emit("role:sound");
soundB.emit("role:sound");
await wait(D);
soundA.close();
await wait(D * 2);
check(
  "1つ閉じても、もう1つ繋がっていれば接続のまま",
  hostState.state?.ytStatus?.connected === true,
);
soundB.close();
await wait(D * 2);
check(
  "全部閉じたら未接続になる",
  hostState.state?.ytStatus?.connected === false,
);

host.close();
player.close();

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
