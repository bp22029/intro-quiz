// 検証スクリプト共通の部屋づくり。
//
// マルチルーム化のあと、テストは「自分専用の部屋を作ってから繋ぐ」。
// これで検証どうしが混ざらなくなり、ブラウザで参加者画面を開いたままでも
// 人数の判定が狂わなくなった（他人の部屋の人は数に入らないため）。
import { io } from "socket.io-client";

/** 部屋をひとつ作る。返る hostKey が投影画面・管理画面の資格になる */
export async function createRoom(base) {
  const r = await fetch(`${base}/api/rooms`, { method: "POST" });
  const d = await r.json();
  if (!r.ok || !d.ok || !d.code || !d.hostKey) {
    throw new Error(`部屋を作れませんでした: ${r.status} ${JSON.stringify(d)}`);
  }
  return { code: d.code, hostKey: d.hostKey, joinUrl: d.joinUrl };
}

/** 最新の state と受信フレームを持ち続けるクライアントにする */
function instrument(s) {
  s.lastState = null;
  s.frames = [];
  s.buzzCount = 0;
  s.missing = false;
  s.on("state", (st) => {
    s.lastState = st;
    s.frames.push(JSON.stringify(st));
  });
  s.on("buzzed", () => s.buzzCount++);
  s.on("room:missing", () => (s.missing = true));
  return s;
}

function connect(base, auth) {
  const s = instrument(io(base, { transports: ["websocket"], auth }));
  return new Promise((res, rej) => {
    s.on("connect", () => res(s));
    s.on("connect_error", rej);
  });
}

/** 主催者側（投影画面・管理画面）。曲データが届く */
export function connectHost(base, hostKey) {
  return connect(base, { hostKey });
}

/** 参加者側。曲データは届かない */
export function connectPlayer(base, code) {
  return connect(base, { room: code });
}

/** 参加者として繋ぎ、名前を登録するところまで */
export async function joinPlayer(base, code, name, clientId) {
  const s = await connectPlayer(base, code);
  s.cid = clientId;
  await new Promise((res) => s.emit("join", { name, clientId }, res));
  return s;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 引数とURLから、往復待ちの標準値を決める */
export function delayFor(url) {
  return Number(process.env.D) || (url.startsWith("https") ? 900 : 250);
}
