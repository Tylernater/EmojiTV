const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const clients = new Map();
const waiting = new Map();
const rooms = new Map();

const leaderboards = {
  face: new Map(),
  hunt: new Map(),
  chat: new Map()
};

const friends = new Map();
const friendRequests = new Map();
const dmHistory = new Map();
const pendingInvites = new Map();

const knownUsers = new Map();

const TOTAL_FACE_ROUNDS = 5;
const TOTAL_HUNT_ROUNDS = 10;
const HUNT_DURATION_MS = 60 * 1000;

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇",
  "🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
  "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩",
  "🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣",
  "😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬",
  "🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗",
  "🤔","🫣","🤭","🫢","🤫","🤥","😶","😐","😑","😬",
  "🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪",
  "😵","🤐","🥴","🤢","🤮","🤧","😷","🤠","🤑","🤡",
  "👻","💀","☠️","👽","🤖","🎃","😺","😸","😹","😻"
];

/*
  Hunt uses COCO-SSD in the browser.

  These are intentionally objects that the model can recognize.
  This prevents the old system from awarding random points.

  Toilet paper is intentionally NOT in the automatic pool because
  COCO-SSD cannot reliably recognize toilet paper.
*/
const HUNT_ITEMS = [
  { emoji: "🍎", label: "apple", className: "apple" },
  { emoji: "🍌", label: "banana", className: "banana" },
  { emoji: "🍊", label: "orange", className: "orange" },
  { emoji: "🥦", label: "broccoli", className: "broccoli" },
  { emoji: "🥕", label: "carrot", className: "carrot" },
  { emoji: "🥪", label: "sandwich", className: "sandwich" },
  { emoji: "🍕", label: "pizza", className: "pizza" },
  { emoji: "🍩", label: "donut", className: "donut" },
  { emoji: "🎂", label: "cake", className: "cake" },
  { emoji: "🥤", label: "cup", className: "cup" },
  { emoji: "🧴", label: "bottle", className: "bottle" },
  { emoji: "📕", label: "book", className: "book" },
  { emoji: "🥄", label: "spoon", className: "spoon" },
  { emoji: "🍴", label: "fork", className: "fork" },
  { emoji: "🔪", label: "knife", className: "knife" },
  { emoji: "🥣", label: "bowl", className: "bowl" },
  { emoji: "🍷", label: "wine glass", className: "wine glass" },
  { emoji: "🧸", label: "teddy bear", className: "teddy bear" },
  { emoji: "📱", label: "cell phone", className: "cell phone" },
  { emoji: "🪥", label: "toothbrush", className: "toothbrush" },
  { emoji: "⚽", label: "sports ball", className: "sports ball" },
  { emoji: "✂️", label: "scissors", className: "scissors" },
  { emoji: "🏺", label: "vase", className: "vase" }
];

const SKIPPABLE_ITEM = "toilet paper";

function safeSend(ws, data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(data));
  } catch {}
}

function getUsername(ws) {
  return ws.username || "Guest";
}

function getFriendSet(username) {
  if (!friends.has(username)) {
    friends.set(username, new Set());
  }
  return friends.get(username);
}

function getRequestSet(username) {
  if (!friendRequests.has(username)) {
    friendRequests.set(username, new Set());
  }
  return friendRequests.get(username);
}

function isFriend(a, b) {
  return getFriendSet(a).has(b);
}

function findClient(username) {
  for (const ws of clients.values()) {
    if (ws.username === username) return ws;
  }
  return null;
}

function isKnownUser(username) {
  return knownUsers.has(username);
}

function onlineUsernames() {
  return [...clients.values()]
    .map(ws => ws.username)
    .filter(name => name && name !== "Guest");
}

function onlinePayload() {
  return {
    type: "online-list",
    count: onlineUsernames().length,
    players: onlineUsernames().map(username => ({
      username,
      online: true
    }))
  };
}

function broadcast(data) {
  for (const ws of clients.values()) {
    safeSend(ws, data);
  }
}

function broadcastOnline() {
  broadcast(onlinePayload());
}

function friendPayload(username) {
  const friendList = [...getFriendSet(username)].map(name => ({
    username: name,
    online: !!findClient(name)
  }));

  const incoming = [...getRequestSet(username)];

  return {
    type: "friend-data",
    friends: friendList,
    incoming
  };
}

function sendFriends(ws) {
  safeSend(ws, friendPayload(getUsername(ws)));
}

function sendFriendsTo(username) {
  const ws = findClient(username);
  if (ws) sendFriends(ws);
}

function addFriend(a, b) {
  getFriendSet(a).add(b);
  getFriendSet(b).add(a);

  getRequestSet(a).delete(b);
  getRequestSet(b).delete(a);

  sendFriendsTo(a);
  sendFriendsTo(b);
}

function leaderboardRows(board) {
  return [...board.entries()]
    .sort((a, b) => b[1].wins - a[1].wins || b[1].score - a[1].score)
    .slice(0, 20)
    .map(([username, data]) => ({
      username,
      wins: data.wins,
      losses: data.losses,
      score: data.score
    }));
}

function leaderboardPayload() {
  return {
    type: "leaderboards",
    face: leaderboardRows(leaderboards.face),
    hunt: leaderboardRows(leaderboards.hunt),
    chat: leaderboardRows(leaderboards.chat)
  };
}

function ensureLeaderboard(mode, username) {
  if (!leaderboards[mode].has(username)) {
    leaderboards[mode].set(username, {
      wins: 0,
      losses: 0,
      score: 0
    });
  }

  return leaderboards[mode].get(username);
}

function recordCompletedGame(room) {
  if (room.completed) return;
  room.completed = true;

  const players = [room.a, room.b];

  if (room.mode === "chat") {
    for (const ws of players) {
      const row = ensureLeaderboard("chat", ws.username);
      row.score += 1;
    }
    return;
  }

  const aScore = room.scores[room.a.id] || 0;
  const bScore = room.scores[room.b.id] || 0;

  const aRow = ensureLeaderboard(room.mode, room.a.username);
  const bRow = ensureLeaderboard(room.mode, room.b.username);

  aRow.score += aScore;
  bRow.score += bScore;

  if (aScore > bScore) {
    aRow.wins++;
    bRow.losses++;
  } else if (bScore > aScore) {
    bRow.wins++;
    aRow.losses++;
  }
}

function clearHuntTimer(room) {
  if (room && room.huntTimer) {
    clearTimeout(room.huntTimer);
    room.huntTimer = null;
  }
}

function nextUnique(list, used, keyFn) {
  const available = list.filter(item => !used.has(keyFn(item)));

  if (!available.length) {
    return null;
  }

  const item = available[Math.floor(Math.random() * available.length)];
  used.add(keyFn(item));
  return item;
}

function nextFaceTarget(room) {
  return nextUnique(
    EMOJIS,
    room.usedTargets,
    emoji => emoji
  );
}

function nextHuntTarget(room) {
  return nextUnique(
    HUNT_ITEMS,
    room.usedTargets,
    item => item.label
  );
}

function clearRoomTimers(room) {
  if (!room) return;

  clearHuntTimer(room);

  if (room.nextRoundTimer) {
    clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = null;
  }
}

function sendRoundStart(room, skipped = false) {
  if (!room || room.completed) return;

  if (room.mode === "face") {
    room.target = nextFaceTarget(room);

    safeSend(room.a, {
      type: "new-round",
      mode: "face",
      round: room.round,
      totalRounds: room.totalRounds,
      target: room.target,
      skipped
    });

    safeSend(room.b, {
      type: "new-round",
      mode: "face",
      round: room.round,
      totalRounds: room.totalRounds,
      target: room.target,
      skipped
    });

    return;
  }

  if (room.mode === "hunt") {
    room.target = nextHuntTarget(room);

    if (!room.target) {
      finishGame(room);
      return;
    }

    room.huntFound = false;
    room.skipReady.clear();

    safeSend(room.a, {
      type: "new-round",
      mode: "hunt",
      round: room.round,
      totalRounds: room.totalRounds,
      target: room.target,
      skipped
    });

    safeSend(room.b, {
      type: "new-round",
      mode: "hunt",
      round: room.round,
      totalRounds: room.totalRounds,
      target: room.target,
      skipped
    });

    startHuntTimer(room);
  }
}

function sendNextRound(room) {
  if (!room || room.completed) return;

  clearHuntTimer(room);

  if (room.round >= room.totalRounds) {
    finishGame(room);
    return;
  }

  room.round++;
  room.roundScores = {};
  room.nextReady.clear();
  room.skipReady.clear();
  room.huntFound = false;

  sendRoundStart(room);
}

function finishGame(room) {
  if (!room || room.completed) return;

  clearRoomTimers(room);

  recordCompletedGame(room);

  const aScore = room.scores[room.a.id] || 0;
  const bScore = room.scores[room.b.id] || 0;

  let winnerUsername = null;

  if (aScore > bScore) winnerUsername = room.a.username;
  if (bScore > aScore) winnerUsername = room.b.username;

  const payload = {
    type: "game-over",
    mode: room.mode,
    totalRounds: room.totalRounds,
    finalScores: {
      [room.a.username]: aScore,
      [room.b.username]: bScore
    },
    winnerUsername
  };

  safeSend(room.a, payload);
  safeSend(room.b, payload);
}

function startHuntTimer(room) {
  clearHuntTimer(room);

  room.huntTimer = setTimeout(() => {
    if (!rooms.has(room.id) || room.completed || room.huntFound) {
      return;
    }

    room.huntFound = true;

    safeSend(room.a, {
      type: "hunt-timeout",
      round: room.round,
      target: room.target
    });

    safeSend(room.b, {
      type: "hunt-timeout",
      round: room.round,
      target: room.target
    });

    room.nextRoundTimer = setTimeout(() => {
      room.nextRoundTimer = null;

      if (rooms.has(room.id) && !room.completed) {
        sendNextRound(room);
      }
    }, 1500);
  }, HUNT_DURATION_MS);
}

function startMatch(a, b, mode) {
  const roomId =
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8);

  const totalRounds =
    mode === "face"
      ? TOTAL_FACE_ROUNDS
      : mode === "hunt"
      ? TOTAL_HUNT_ROUNDS
      : 1;

  const room = {
    id: roomId,
    a,
    b,
    mode,
    round: 1,
    totalRounds,
    usedTargets: new Set(),
    target: null,
    scores: {
      [a.id]: 0,
      [b.id]: 0
    },
    roundScores: {},
    nextReady: new Set(),
    rematchReady: new Set(),
    skipReady: new Set(),
    huntFound: false,
    huntTimer: null,
    nextRoundTimer: null,
    completed: false
  };

  rooms.set(roomId, room);

  a.roomId = roomId;
  b.roomId = roomId;

  waiting.delete(a);
  waiting.delete(b);

  if (mode === "face") {
    room.target = nextFaceTarget(room);
  }

  if (mode === "hunt") {
    room.target = nextHuntTarget(room);
  }

  const base = {
    type: "matched",
    roomId,
    mode,
    round: 1,
    totalRounds,
    target: room.target,
    opponentId: null,
    opponentUsername: null
  };

  safeSend(a, {
    ...base,
    initiator: true,
    role: "a",
    opponentId: b.id,
    opponentUsername: b.username
  });

  safeSend(b, {
    ...base,
    initiator: false,
    role: "b",
    opponentId: a.id,
    opponentUsername: a.username
  });

  if (mode === "hunt") {
    startHuntTimer(room);
  }
}

function tryMatch(ws, mode) {
  if (!ws.username || ws.username === "Guest") {
    safeSend(ws, {
      type: "error",
      message: "Please enter a username first."
    });
    return;
  }

  if (ws.roomId) {
    safeSend(ws, {
      type: "error",
      message: "You are already in a game."
    });
    return;
  }

  const old = waiting.get(ws);

  if (old) {
    waiting.delete(ws);
  }

  let opponent = null;

  for (const [candidate, candidateMode] of waiting.entries()) {
    if (
      candidate !== ws &&
      candidateMode === mode &&
      candidate.readyState === WebSocket.OPEN &&
      !candidate.roomId
    ) {
      opponent = candidate;
      break;
    }
  }

  if (opponent) {
    waiting.delete(opponent);
    startMatch(opponent, ws, mode);
  } else {
    waiting.set(ws, mode);

    safeSend(ws, {
      type: "waiting",
      mode
    });
  }
}

function removeFromWaiting(ws) {
  waiting.delete(ws);
}

function getRoom(ws) {
  if (!ws.roomId) return null;
  return rooms.get(ws.roomId) || null;
}

function otherPlayer(room, ws) {
  if (!room) return null;
  return room.a === ws ? room.b : room.a;
}

function endRoom(ws, notifyOpponent = true) {
  const room = getRoom(ws);

  removeFromWaiting(ws);

  if (!room) {
    ws.roomId = null;
    return;
  }

  clearRoomTimers(room);

  const opponent = otherPlayer(room, ws);

  rooms.delete(room.id);

  room.a.roomId = null;
  room.b.roomId = null;

  if (notifyOpponent && opponent) {
    safeSend(opponent, {
      type: "opponent-left",
      username: ws.username
    });
  }

  safeSend(ws, {
    type: "left-room"
  });
}

function setUsername(ws, requested) {
  let username = String(requested || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);

  if (!username) {
    safeSend(ws, {
      type: "username-error",
      message: "Please enter a username."
    });
    return;
  }

  if (!/^[a-zA-Z0-9 _-]+$/.test(username)) {
    safeSend(ws, {
      type: "username-error",
      message: "Use only letters, numbers, spaces, - or _."
    });
    return;
  }

  for (const other of clients.values()) {
    if (other !== ws && other.username === username) {
      safeSend(ws, {
        type: "username-error",
        message: "That username is already online."
      });
      return;
    }
  }

  const oldName = ws.username;

  ws.username = username;
  knownUsers.set(username, Date.now());

  if (oldName && oldName !== "Guest" && oldName !== username) {
    if (friends.has(oldName)) {
      const oldFriends = friends.get(oldName);
      friends.set(username, new Set(oldFriends));

      for (const friend of oldFriends) {
        getFriendSet(friend).delete(oldName);
        getFriendSet(friend).add(username);
      }

      friends.delete(oldName);
    }

    if (friendRequests.has(oldName)) {
      friendRequests.set(username, new Set(friendRequests.get(oldName)));
      friendRequests.delete(oldName);
    }
  }

  safeSend(ws, {
    type: "username-saved",
    username
  });

  sendFriends(ws);
  broadcastOnline();
}

function sendSearchResults(ws, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .slice(0, 20);

  if (!q) {
    safeSend(ws, {
      type: "user-search-results",
      results: []
    });
    return;
  }

  const results = [];

  for (const username of knownUsers.keys()) {
    if (username === ws.username) continue;

    if (!username.toLowerCase().includes(q)) continue;

    const incoming = getRequestSet(username).has(ws.username);

    let outgoing = false;

    for (const requester of friendRequests.get(username) || []) {
      if (requester === ws.username) {
        outgoing = true;
      }
    }

    results.push({
      username,
      online: !!findClient(username),
      friend: isFriend(ws.username, username),
      outgoing: getRequestSet(username).has(ws.username),
      incoming: getRequestSet(ws.username).has(username)
    });

    if (results.length >= 20) break;
  }

  safeSend(ws, {
    type: "user-search-results",
    results
  });
}

function sendDMHistory(ws, withUsername) {
  const key = [ws.username, withUsername].sort().join("|");

  safeSend(ws, {
    type: "dm-history",
    with: withUsername,
    messages: dmHistory.get(key) || []
  });
}

function saveDM(a, b, text) {
  const key = [a, b].sort().join("|");

  if (!dmHistory.has(key)) {
    dmHistory.set(key, []);
  }

  const messages = dmHistory.get(key);

  messages.push({
    from: a,
    to: b,
    text,
    timestamp: Date.now()
  });

  if (messages.length > 100) {
    messages.shift();
  }
}

wss.on("connection", ws => {
  ws.id =
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  ws.username = "Guest";
  ws.roomId = null;

  clients.set(ws.id, ws);

  safeSend(ws, {
    type: "ready"
  });

  safeSend(ws, onlinePayload());
  safeSend(ws, leaderboardPayload());

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, {
        type: "error",
        message: "Invalid message."
      });
      return;
    }

    const type = data.type;

    if (type === "identify" || type === "set-username") {
      setUsername(ws, data.username);
      return;
    }

    if (type === "get-friends") {
      sendFriends(ws);
      return;
    }

    if (type === "search-users") {
      sendSearchResults(ws, data.query);
      return;
    }

    if (type === "friend-request") {
      const from = ws.username;
      const to = String(data.username || "").trim();

      if (!to || to === from) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "You cannot friend yourself."
        });
        return;
      }

      if (!isKnownUser(to)) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "That username has not been seen on EmojiTV yet."
        });
        return;
      }

      if (isFriend(from, to)) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "You are already friends."
        });
        return;
      }

      if (getRequestSet(to).has(from)) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "Friend request already sent."
        });
        return;
      }

      getRequestSet(to).add(from);

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message: "Friend request sent."
      });

      const target = findClient(to);

      if (target) {
        safeSend(target, {
          type: "friend-request-received",
          from
        });

        sendFriends(target);
      }

      return;
    }

    if (type === "friend-accept") {
      const from = String(data.from || "").trim();
      const to = ws.username;

      if (!from || !getRequestSet(to).has(from)) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message: "That friend request is no longer available."
        });
        return;
      }

      addFriend(to, from);

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message: "Friend request accepted."
      });

      const requester = findClient(from);

      if (requester) {
        safeSend(requester, {
          type: "friend-request-accepted",
          username: to
        });
      }

      return;
    }

    if (type === "friend-decline") {
      const from = String(data.from || "").trim();

      getRequestSet(ws.username).delete(from);

      sendFriends(ws);

      return;
    }

    if (type === "dm") {
      const to = String(data.to || "").trim();
      const text = String(data.text || "").trim().slice(0, 500);

      if (!to || !text) return;

      if (!isFriend(ws.username, to)) {
        safeSend(ws, {
          type: "error",
          message: "You can only message friends."
        });
        return;
      }

      saveDM(ws.username, to, text);

      safeSend(ws, {
        type: "dm",
        from: ws.username,
        to,
        text,
        timestamp: Date.now()
      });

      const target = findClient(to);

      if (target) {
        safeSend(target, {
          type: "dm",
          from: ws.username,
          to,
          text,
          timestamp: Date.now()
        });
      }

      return;
    }

    if (type === "get-dm-history") {
      const withUsername = String(data.with || "").trim();

      if (withUsername) {
        sendDMHistory(ws, withUsername);
      }

      return;
    }

    if (type === "friend-invite") {
      const to = String(data.to || "").trim();
      const mode = ["face", "hunt", "chat"].includes(data.mode)
        ? data.mode
        : "face";

      if (!isFriend(ws.username, to)) {
        safeSend(ws, {
          type: "invite-result",
          ok: false,
          message: "You can only invite friends."
        });
        return;
      }

      const target = findClient(to);

      if (!target) {
        safeSend(ws, {
          type: "invite-result",
          ok: false,
          message: "That friend is offline."
        });
        return;
      }

      const inviteId =
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);

      pendingInvites.set(inviteId, {
        from: ws.username,
        to,
        mode,
        timestamp: Date.now()
      });

      safeSend(target, {
        type: "game-invite",
        inviteId,
        from: ws.username,
        mode
      });

      safeSend(ws, {
        type: "invite-result",
        ok: true,
        message: "Game invite sent."
      });

      return;
    }

    if (type === "decline-invite") {
      const inviteId = String(data.inviteId || "");
      pendingInvites.delete(inviteId);
      return;
    }

    if (type === "accept-invite") {
      const inviteId = String(data.inviteId || "");
      const invite = pendingInvites.get(inviteId);

      if (!invite) {
        safeSend(ws, {
          type: "error",
          message: "That invite expired."
        });
        return;
      }

      if (invite.to !== ws.username) {
        return;
      }

      pendingInvites.delete(inviteId);

      const inviter = findClient(invite.from);

      if (!inviter) {
        safeSend(ws, {
          type: "error",
          message: "The other player is no longer online."
        });
        return;
      }

      if (inviter.roomId || ws.roomId) {
        safeSend(ws, {
          type: "error",
          message: "One of you is already in a game."
        });
        return;
      }

      startMatch(inviter, ws, invite.mode);
      return;
    }

    if (type === "get-leaderboards") {
      safeSend(ws, leaderboardPayload());
      return;
    }

    if (type === "report") {
      const target = String(data.username || "").trim();
      const reason = String(data.reason || "other").slice(0, 50);
      const details = String(data.details || "").slice(0, 500);

      console.log("REPORT:", {
        from: ws.username,
        target,
        reason,
        details,
        timestamp: Date.now()
      });

      safeSend(ws, {
        type: "report-result",
        ok: true,
        message: "Report submitted."
      });

      return;
    }

    if (type === "find-match") {
      const mode = ["face", "hunt", "chat"].includes(data.mode)
        ? data.mode
        : "face";

      tryMatch(ws, mode);
      return;
    }

    if (type === "leave") {
      endRoom(ws, true);
      return;
    }

    if (type === "rematch-ready") {
      const room = getRoom(ws);

      if (!room) return;

      room.rematchReady.add(ws.id);

      if (room.rematchReady.size === 2) {
        clearRoomTimers(room);

        room.round = 1;
        room.usedTargets = new Set();
        room.scores = {
          [room.a.id]: 0,
          [room.b.id]: 0
        };
        room.roundScores = {};
        room.nextReady.clear();
        room.skipReady.clear();
        room.huntFound = false;
        room.completed = false;

        if (room.mode === "face") {
          room.target = nextFaceTarget(room);
        } else if (room.mode === "hunt") {
          room.target = nextHuntTarget(room);
        } else {
          room.target = null;
        }

        safeSend(room.a, {
          type: "rematch-started",
          mode: room.mode,
          round: 1,
          totalRounds: room.totalRounds,
          target: room.target,
          opponentUsername: room.b.username
        });

        safeSend(room.b, {
          type: "rematch-started",
          mode: room.mode,
          round: 1,
          totalRounds: room.totalRounds,
          target: room.target,
          opponentUsername: room.a.username
        });

        room.rematchReady.clear();

        if (room.mode === "hunt") {
          startHuntTimer(room);
        }
      }

      return;
    }

    if (type === "skip-item") {
      const room = getRoom(ws);

      if (!room || room.mode !== "hunt") return;

      if (!room.target || room.target.label !== SKIPPABLE_ITEM) {
        safeSend(ws, {
          type: "error",
          message: "Only toilet paper can be skipped."
        });
        return;
      }

      room.skipReady.add(ws.id);

      const readyCount = room.skipReady.size;

      safeSend(room.a, {
        type: "skip-item-status",
        ready: readyCount,
        required: 2
      });

      safeSend(room.b, {
        type: "skip-item-status",
        ready: readyCount,
        required: 2
      });

      if (readyCount === 2) {
        clearHuntTimer(room);
        room.huntFound = false;

        // Mark the skipped target as used so it cannot repeat.
        room.usedTargets.add(room.target.label);

        room.target = nextHuntTarget(room);

        if (!room.target) {
          finishGame(room);
          return;
        }

        room.skipReady.clear();

        safeSend(room.a, {
          type: "new-round",
          mode: "hunt",
          round: room.round,
          totalRounds: room.totalRounds,
          target: room.target,
          skipped: true
        });

        safeSend(room.b, {
          type: "new-round",
          mode: "hunt",
          round: room.round,
          totalRounds: room.totalRounds,
          target: room.target,
          skipped: true
        });

        startHuntTimer(room);
      }

      return;
    }

    if (type === "round-score") {
      const room = getRoom(ws);

      if (!room || room.mode !== "face") return;
      if (room.completed) return;

      if (room.roundScores[ws.id] !== undefined) {
        return;
      }

      let score = Number(data.score);

      if (!Number.isFinite(score)) score = 0;

      score = Math.max(0, Math.min(100, Math.round(score)));

      room.roundScores[ws.id] = score;

      if (
        room.roundScores[room.a.id] !== undefined &&
        room.roundScores[room.b.id] !== undefined
      ) {
        const aScore = room.roundScores[room.a.id];
        const bScore = room.roundScores[room.b.id];

        if (aScore > bScore) {
          room.scores[room.a.id]++;
        } else if (bScore > aScore) {
          room.scores[room.b.id]++;
        }

        let winnerUsername = null;

        if (aScore > bScore) winnerUsername = room.a.username;
        if (bScore > aScore) winnerUsername = room.b.username;

        safeSend(room.a, {
          type: "round-result",
          round: room.round,
          scores: {
            [room.a.username]: aScore,
            [room.b.username]: bScore
          },
          totals: {
            [room.a.username]: room.scores[room.a.id],
            [room.b.username]: room.scores[room.b.id]
          },
          winnerUsername
        });

        safeSend(room.b, {
          type: "round-result",
          round: room.round,
          scores: {
            [room.a.username]: aScore,
            [room.b.username]: bScore
          },
          totals: {
            [room.a.username]: room.scores[room.a.id],
            [room.b.username]: room.scores[room.b.id]
          },
          winnerUsername
        });

        room.nextRoundTimer = setTimeout(() => {
          room.nextRoundTimer = null;

          if (rooms.has(room.id) && !room.completed) {
            sendNextRound(room);
          }
        }, 2200);
      }

      return;
    }

    if (type === "hunt-found") {
      const room = getRoom(ws);

      if (!room || room.mode !== "hunt") return;
      if (room.completed || room.huntFound) return;

      clearHuntTimer(room);

      room.huntFound = true;

      room.scores[ws.id]++;

      const winnerUsername = ws.username;

      const payload = {
        type: "hunt-winner",
        round: room.round,
        winnerUsername,
        target: room.target,
        scores: {
          [room.a.username]: room.scores[room.a.id],
          [room.b.username]: room.scores[room.b.id]
        }
      };

      safeSend(room.a, payload);
      safeSend(room.b, payload);

      room.nextRoundTimer = setTimeout(() => {
        room.nextRoundTimer = null;

        if (rooms.has(room.id) && !room.completed) {
          sendNextRound(room);
        }
      }, 2200);

      return;
    }

    if (type === "next-round") {
      const room = getRoom(ws);

      if (!room) return;

      room.nextReady.add(ws.id);

      if (room.nextReady.size === 2) {
        room.nextReady.clear();
        sendNextRound(room);
      }

      return;
    }

    if (type === "chat-message") {
      const room = getRoom(ws);

      if (!room || room.mode !== "chat") return;

      const text = String(data.text || "")
        .trim()
        .slice(0, 500);

      if (!text) return;

      const opponent = otherPlayer(room, ws);

      safeSend(opponent, {
        type: "chat-message",
        from: ws.username,
        text,
        timestamp: Date.now()
      });

      safeSend(ws, {
        type: "chat-message",
        from: ws.username,
        text,
        timestamp: Date.now()
      });

      return;
    }

    if (type === "signal") {
      const room = getRoom(ws);

      if (!room) return;

      const opponent = otherPlayer(room, ws);

      if (!opponent) return;

      safeSend(opponent, {
        type: "signal",
        from: ws.username,
        signal: data.signal
      });

      return;
    }
  });

  ws.on("close", () => {
    removeFromWaiting(ws);

    for (const [inviteId, invite] of pendingInvites.entries()) {
      if (
        invite.from === ws.username ||
        invite.to === ws.username
      ) {
        pendingInvites.delete(inviteId);
      }
    }

    const room = getRoom(ws);

    if (room) {
      clearRoomTimers(room);

      const opponent = otherPlayer(room, ws);

      rooms.delete(room.id);

      room.a.roomId = null;
      room.b.roomId = null;

      if (opponent) {
        safeSend(opponent, {
          type: "opponent-left",
          username: ws.username
        });
      }
    }

    clients.delete(ws.id);

    broadcastOnline();

    for (const username of onlineUsernames()) {
      sendFriendsTo(username);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EmojiTV server running on port ${PORT}`);
});
