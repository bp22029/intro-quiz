// URL から「どの部屋の、どの立場で開いたか」を読む。
// ルーティングライブラリは入れない方針なので、pathname を素直に見るだけにする。
//
//   /                      ロビー（部屋を作る・コードを入れて参加する）
//   /r/<参加コード>         参加者（スマホ）
//   /screen/<主催キー>      投影画面（表示専用）
//   /host/<主催キー>        管理画面（進行操作・YouTube再生）
//
// 参加コードは QR とURLに載り、口頭でも読み上げる。だから短くて読める形にする。
// 主催キーはそれ自体が主催者の資格なので、推測できない長さにしてコピペで渡す。
// 投影画面も主催キー側に置いているのは、曲データ（＝答え）を受け取る側だから。
// 権限の境界を「参加コード / 主催キー」の1本にしておくほうが運用を間違えにくい。

export type RoomRef =
  | { kind: "lobby" }
  | { kind: "player"; code: string }
  | { kind: "screen"; hostKey: string }
  | { kind: "host"; hostKey: string };

/** 参加コードの正規化。サーバー側の normalizeCode と同じ規則にする */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

/** 主催キーに使える文字か。URLの打ち間違いを早い段階で弾く */
function isHostKey(raw: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw);
}

export function parseRoomRef(pathname: string): RoomRef {
  const seg = pathname.split("/").filter((s) => s.length > 0);

  if (seg[0] === "r" && seg[1]) {
    const code = normalizeCode(decodeURIComponent(seg[1]));
    if (code) return { kind: "player", code };
  }
  if (seg[0] === "screen" && seg[1] && isHostKey(seg[1])) {
    return { kind: "screen", hostKey: seg[1] };
  }
  if (seg[0] === "host" && seg[1] && isHostKey(seg[1])) {
    return { kind: "host", hostKey: seg[1] };
  }
  // 部屋を指していないURL（/ と、キーの無い裸の /host や /screen）はロビー扱い
  return { kind: "lobby" };
}

/**
 * ページを開いた時点で確定する。以後この参照は変わらない。
 * 検証スクリプトは Node からこのモジュールを import するので、
 * window が無い場合はロビー扱いにして読み込みだけは通す。
 */
export const roomRef: RoomRef =
  typeof window === "undefined"
    ? { kind: "lobby" }
    : parseRoomRef(window.location.pathname);

/** Socket.IO のハンドシェイクに載せる名乗り。ロビーでは繋がない */
export function handshakeAuth(ref: RoomRef): Record<string, string> | null {
  switch (ref.kind) {
    case "player":
      return { room: ref.code };
    case "screen":
    case "host":
      return { hostKey: ref.hostKey };
    case "lobby":
      return null;
  }
}

export const playerPath = (code: string) => `/r/${code}`;
export const hostPath = (hostKey: string) => `/host/${hostKey}`;
export const screenPath = (hostKey: string) => `/screen/${hostKey}`;
