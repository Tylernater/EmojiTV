import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const waiting = [];
const rooms = new Map();
const clients = new Set();

const leaderboard = {
  face: new Map(),
  hunt: new Map(),
  chat: new Map(),
  pose: new Map(),
  laugh: new Map()
};

const reports = [];
const MAX_REPORTS = 5000;

const friends = new Map();
const friendRequests = new Map();
const dmHistory = new Map();
const pendingInvites = new Map();

/*
  A session survives a temporary browser/network disconnect.
  The room is NOT destroyed unless the player presses Leave.
*/
const sessions = new Map();
const profiles = new Map();

const XP_PER_LEVEL = 500;

const DAILY_CHALLENGES = [
  {
    id: "play-3",
    event: "game",
    title: "Play 3 games",
    target: 3,
    reward: 100
  },
  {
    id: "win-1",
    event: "win",
    title: "Win 1 game",
    target: 1,
    reward: 150
  },
  {
    id: "score-80",
    event: "score80",
    title: "Score 80+ in a Face-Off round",
    target: 1,
    reward: 200
  },
  {
    id: "hunt-3",
    event: "hunt",
    title: "Find 3 Hunt items",
    target: 3,
    reward: 150
  },
  {
    id: "streak-3",
    event: "streak",
    title: "Reach a 3-win streak",
    target: 3,
    reward: 250
  },
  {
    id: "friends-5",
    event: "friend",
    title: "Make 5 friends",
    target: 5,
    reward: 200
  }
];

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇",
  "🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
  "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩",
  "🥳","🤗","🫠","🫡","🤔","🫢","🫣","🫤","🫥","😐",
  "😑","😶","🫨","😏","😒","🙄","😬","🤥","😶‍🌫️","😴",
  "🤤","😪","😵","😵‍💫","🤐","🤢","🤮","🤧","😷","🤒",
  "🤕","🥴","🥶","🥵","😳","😯","😦","😧","😟","😕",
  "🙁","☹️","😞","😔","😢","😭","😥","😓","😰","😨",
  "😱","😖","😣","😫","😩","🥺","🥹","😠","😡","🤬",
  "😤","😮‍💨","😮","😲","🤯","🤭","🤫","🤠","🥸","😈",
  "👿","💀","☠️","👻","👽","🤖","🎃","😺","😸","😹",
  "😻","😼","😽","🙀","😿","😾"
];

const HUNT_ITEMS = [
  {
    emoji: "🧻",
    label: "toilet paper",
    aliases: ["toilet paper", "a roll of toilet paper"]
  },
  {
    emoji: "🍎",
    label: "apple",
    aliases: ["an apple", "a red apple", "apple"]
  },
  {
    emoji: "🍌",
    label: "banana",
    aliases: ["a banana", "banana"]
  },
  {
    emoji: "🥤",
    label: "cup",
    aliases: ["a cup", "a drinking cup", "plastic cup"]
  },
  {
    emoji: "🧴",
    label: "bottle",
    aliases: ["a bottle", "a plastic bottle", "water bottle"]
  },
  {
    emoji: "📕",
    label: "book",
    aliases: ["a book", "a red book"]
  },
  {
    emoji: "🥄",
    label: "spoon",
    aliases: ["a spoon", "a metal spoon"]
  },
  {
    emoji: "🧸",
    label: "teddy bear",
    aliases: ["a teddy bear", "a stuffed bear", "stuffed animal"]
  },
  {
    emoji: "📱",
    label: "cell phone",
    aliases: ["a cell phone", "a smartphone", "a phone"]
  },
  {
    emoji: "🪥",
    label: "toothbrush",
    aliases: ["a toothbrush", "toothbrush"]
  },
  {
    emoji: "🎧",
    label: "headphones",
    aliases: ["headphones", "a pair of headphones"]
  },
  {
    emoji: "🕶️",
    label: "sunglasses",
    aliases: ["sunglasses", "a pair of sunglasses"]
  },
  {
    emoji: "⚽",
    label: "soccer ball",
    aliases: ["a soccer ball", "soccer ball"]
  },
  {
    emoji: "🏀",
    label: "basketball",
    aliases: ["a basketball", "basketball"]
  },
  {
    emoji: "🎮",
    label: "game controller",
    aliases: ["a game controller", "controller"]
  },
  {
    emoji: "⌚",
    label: "watch",
    aliases: ["a watch", "smartwatch"]
  },
  {
    emoji: "✏️",
    label: "pencil",
    aliases: ["a pencil", "pencil"]
  },
  {
    emoji: "🖊️",
    label: "pen",
    aliases: ["a pen", "pen"]
  },
  {
    emoji: "🧢",
    label: "cap",
    aliases: ["a cap", "a baseball cap", "hat"]
  },
  {
    emoji: "👟",
    label: "shoe",
    aliases: ["a shoe", "sneaker"]
  }
];

const TOTAL_FACE_ROUNDS = 5;
const TOTAL_POSE_ROUNDS = 5;
const TOTAL_LAUGH_ROUNDS = 3;
const TOTAL_HUNT_ROUNDS = 10;

const LAUGH_TIMEOUT_MS = 30000;
const HUNT_SECONDS = 60;
const HUNT_TIMEOUT_MS = HUNT_SECONDS * 1000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    game: "EmojiTV"
  });
});

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }
}

function broadcast(data) {
  for (const ws of clients) {
    send(ws, data);
  }
}

function createId() {
  return crypto.randomUUID();
}

function cleanName(name) {
  const value = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);

  return value || "Guest";
}

function removeFromWaiting(ws) {
  const index = waiting.indexOf(ws);

  if (index !== -1) {
    waiting.splice(index, 1);
  }
}

function sessionKey(value) {
  const v = String(value || "").trim();

  if (v.length >= 16 && v.length <= 100) {
    return v;
  }

  return null;
}

function saveSession(ws) {
  if (!ws.sessionId) return;

  sessions.set(ws.sessionId, {
    playerId: ws.playerId,
    username: ws.username,
    roomId: ws.roomId || null,
    role: ws.role || null
  });
}

function clearSessionRoom(ws) {
  if (!ws.sessionId) return;

  const session = sessions.get(ws.sessionId);

  if (!session) return;

  session.roomId = null;
  session.role = null;
  session.playerId = ws.playerId;
  session.username = ws.username;
}

function sendRoomState(ws, room) {
  if (!ws || !room) return;

  const opponent =
    room.a === ws
      ? room.b
      : room.a;

  send(ws, {
    type: "session-restored",
    playerId: ws.playerId,
    roomId: room.id,
    round: room.round,
    totalRounds: room.totalRounds,
    mode: room.mode,
    target: room.target,
    role: ws.role,
    opponentId: opponent?.playerId || null,
    opponentUsername: opponent?.username || "PLAYER",
    opponentConnected:
      !!opponent &&
      opponent.readyState === 1,
    scores: room.scores
  });
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function modeRounds(mode) {
  if (mode === "hunt") {
    return TOTAL_HUNT_ROUNDS;
  }

  if (mode === "laugh") {
    return TOTAL_LAUGH_ROUNDS;
  }

  if (mode === "pose") {
    return TOTAL_POSE_ROUNDS;
  }

  return TOTAL_FACE_ROUNDS;
}

function nextUnique(list, used) {
  const available = list.filter(item => {
    const key =
      typeof item === "string"
        ? item
        : item.emoji;

    return !used.has(key);
  });

  const pick =
    randomItem(
      available.length
        ? available
        : list
    );

  used.add(
    typeof pick === "string"
      ? pick
      : pick.emoji
  );

  return pick;
}

function nextHuntTarget(used) {
  return {
    ...nextUnique(HUNT_ITEMS, used)
  };
}

function pairKey(a, b) {
  return [a, b]
    .sort()
    .join("\u0000");
}

function ensureSet(map, key) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }

  return map.get(key);
}

function isFriend(a, b) {
  return ensureSet(friends, a).has(b);
}

function friendPayload(username) {
  const list = [
    ...ensureSet(friends, username)
  ];

  const pending = [
    ...ensureSet(friendRequests, username)
  ];

  return {
    type: "friends",

    friends: list.map(name => ({
      username: name,
      online: [...clients].some(
        c => c.username === name
      )
    })),

    pending
  };
}

function sendFriends(username) {
  for (const c of clients) {
    if (c.username === username) {
      send(
        c,
        friendPayload(username)
      );
    }
  }
}

function sendDmHistory(a, b) {
  const history =
    dmHistory.get(pairKey(a, b)) || [];

  for (const c of clients) {
    if (c.username === a) {
      send(c, {
        type: "dm-history",
        with: b,
        messages: history.slice(-100)
      });
    }
  }
}

function addDm(a, b, text) {
  const key = pairKey(a, b);
  const history =
    dmHistory.get(key) || [];

  history.push({
    from: a,
    to: b,
    text,
    createdAt:
      new Date().toISOString()
  });

  if (history.length > 200) {
    history.shift();
  }

  dmHistory.set(key, history);
}

function onlinePayload() {
  const names = [...clients]
    .map(ws => ws.username || "Guest")
    .sort((a, b) =>
      a.localeCompare(b)
    );

  return {
    type: "online-list",
    count: clients.size,
    names
  };
}

function broadcastOnline() {
  broadcast(onlinePayload());

  for (const c of clients) {
    sendFriends(c.username);
  }
}

function todayKey() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function challengeSetForToday() {
  const day =
    Math.floor(
      Date.parse(
        todayKey() + "T00:00:00Z"
      ) / 86400000
    );

  return [0, 1, 2].map(
    i =>
      DAILY_CHALLENGES[
        (day + i) %
        DAILY_CHALLENGES.length
      ]
  );
}

function ensureProfile(username) {
  if (!profiles.has(username)) {
    profiles.set(username, {
      username,
      xp: 0,
      level: 1,
      streak: 0,
      bestStreak: 0,
      gamesPlayed: 0,
      wins: 0,
      badges: new Set(),
      daily: {
        date: todayKey(),
        progress: {},
        completed: []
      }
    });
  }

  const profile =
    profiles.get(username);

  if (profile.daily.date !== todayKey()) {
    profile.daily = {
      date: todayKey(),
      progress: {},
      completed: []
    };
  }

  profile.level =
    Math.floor(
      profile.xp / XP_PER_LEVEL
    ) + 1;

  return profile;
}

function addXp(profile, amount) {
  profile.xp += Math.max(
    0,
    Math.round(amount)
  );

  profile.level =
    Math.floor(
      profile.xp / XP_PER_LEVEL
    ) + 1;
}

function ensureStats(mode, username) {
  if (!leaderboard[mode].has(username)) {
    leaderboard[mode].set(
      username,
      {
        username,
        wins: 0,
        points: 0,
        games: 0
      }
    );
  }

  return leaderboard[mode].get(username);
}

function dailyPayload(username) {
  const profile =
    ensureProfile(username);

  const definitions =
    challengeSetForToday();

  return {
    date: profile.daily.date,

    challenges:
      definitions.map(c => ({
        ...c,

        progress: Math.min(
          c.target,
          Number(
            profile.daily.progress[c.id] || 0
          )
        ),

        completed:
          profile.daily.completed.includes(
            c.id
          )
      }))
  };
}

function profilePayload(username) {
  const profile =
    ensureProfile(username);

  return {
    type: "profile",

    username:
      profile.username,

    xp:
      profile.xp,

    level:
      profile.level,

    xpIntoLevel:
      profile.xp % XP_PER_LEVEL,

    xpToNextLevel:
      XP_PER_LEVEL -
      (profile.xp % XP_PER_LEVEL),

    streak:
      profile.streak,

    bestStreak:
      profile.bestStreak,

    gamesPlayed:
      profile.gamesPlayed,

    wins:
      profile.wins,

    badges:
      [...profile.badges],

    daily:
      dailyPayload(username)
  };
}

function sendProfile(username) {
  for (const c of clients) {
    if (c.username === username) {
      send(
        c,
        profilePayload(username)
      );
    }
  }
}

function badgeCheck(profile) {
  const earned =
    new Set(profile.badges);

  if (profile.wins >= 1) {
    earned.add("first-win");
  }

  if (profile.bestStreak >= 10) {
    earned.add("streak-10");
  }

  if (profile.gamesPlayed >= 100) {
    earned.add("games-100");
  }

  const hunt =
    leaderboard.hunt.get(
      profile.username
    );

  if (hunt && hunt.wins >= 1) {
    earned.add("hunt-master");
  }

  if (
    ensureSet(
      friends,
      profile.username
    ).size >= 10
  ) {
    earned.add("friends-10");
  }

  if (profile.bestStreak >= 5) {
    earned.add("streak-5");
  }

  profile.badges = earned;
}

function updateDaily(
  username,
  event,
  amount = 1
) {
  const profile =
    ensureProfile(username);

  const definitions =
    challengeSetForToday();

  let changed = false;

  for (const c of definitions) {
    if (
      c.event !== event ||
      profile.daily.completed.includes(
        c.id
      )
    ) {
      continue;
    }

    const current =
      Number(
        profile.daily.progress[c.id] || 0
      );

    const next =
      c.event === "streak"
        ? Math.max(current, amount)
        : current + amount;

    profile.daily.progress[c.id] =
      Math.min(
        c.target,
        next
      );

    changed = true;

    if (
      profile.daily.progress[c.id] >=
      c.target
    ) {
      profile.daily.completed.push(
        c.id
      );

      addXp(
        profile,
        c.reward
      );

      send(
        profile.username,
        {
          type: "daily-complete",
          challengeId: c.id,
          title: c.title,
          reward: c.reward
        }
      );
    }
  }

  return changed;
}

function updateProfileAndSend(username) {
  const profile =
    ensureProfile(username);

  badgeCheck(profile);

  sendProfile(username);
}

function applyGameResult(room) {
  if (!room || room.completed) {
    return null;
  }

  room.completed = true;

  const players = [
    room.a,
    room.b
  ];

  const scores =
    room.scores;

  const aScore =
    scores[room.a.playerId] || 0;

  const bScore =
    scores[room.b.playerId] || 0;

  const winnerIds =
    aScore === bScore
      ? new Set()
      : new Set([
          aScore > bScore
            ? room.a.playerId
            : room.b.playerId
        ]);

  for (const player of players) {
    const stats =
      ensureStats(
        room.mode,
        player.username
      );

    stats.games += 1;

    stats.points +=
      scores[player.playerId] || 0;

    const profile =
      ensureProfile(
        player.username
      );

    profile.gamesPlayed += 1;

    const won =
      winnerIds.has(
        player.playerId
      );

    if (won) {
      stats.wins += 1;

      profile.wins += 1;

      profile.streak += 1;

      profile.bestStreak =
        Math.max(
          profile.bestStreak,
          profile.streak
        );
    } else if (
      room.mode !== "chat"
    ) {
      profile.streak = 0;
    }

    let xp =
      room.mode === "chat"
        ? 25
        : 30;

    if (won) {
      xp += 100;
    }

    if (room.mode === "face") {
      xp += Math.min(
        50,
        Math.floor(
          (scores[player.playerId] || 0) /
            10
        )
      );
    }

    if (room.mode === "hunt") {
      xp +=
        (scores[player.playerId] || 0) *
        10;
    }

    if (room.mode === "pose") {
      xp += Math.min(
        50,
        Math.floor(
          (scores[player.playerId] || 0) /
            10
        )
      );
    }

    if (room.mode === "laugh") {
      xp +=
        (scores[player.playerId] || 0) *
        40;
    }

    addXp(profile, xp);

    updateDaily(
      player.username,
      "game",
      1
    );

    if (won) {
      updateDaily(
        player.username,
        "win",
        1
      );
    }

    if (
      room.mode === "face" &&
      (room.bestFaceRound?.[
        player.playerId
      ] || 0) >= 80
    ) {
      updateDaily(
        player.username,
        "score80",
        1
      );
    }

    if (
      room.mode === "face" &&
      room.perfectFace?.[
        player.playerId
      ]
    ) {
      ensureProfile(
        player.username
      ).badges.add(
        "perfect-face"
      );
    }

    if (room.mode === "hunt") {
      updateDaily(
        player.username,
        "hunt",
        scores[player.playerId] || 0
      );
    }

    if (room.mode !== "chat") {
      updateDaily(
        player.username,
        "streak",
        profile.streak
      );
    }

    badgeCheck(profile);
  }

  for (const player of players) {
    updateProfileAndSend(
      player.username
    );
  }

  broadcastLeaderboards();

  return {
    winnerIds,
    aScore,
    bScore
  };
}

function recordCompletedGame(room) {
  return applyGameResult(room);
}

function leaderboardPayload(mode) {
  const rows =
    [...leaderboard[mode].values()]
      .sort(
        (a, b) =>
          b.wins - a.wins ||
          b.points - a.points ||
          a.username.localeCompare(
            b.username
          )
      )
      .slice(0, 20)
      .map(
        (x, i) => ({
          rank: i + 1,
          ...x
        })
      );

  return {
    mode,
    rows
  };
}

function xpLeaderboardPayload() {
  const rows =
    [...profiles.values()]
      .sort(
        (a, b) =>
          b.xp - a.xp ||
          b.level - a.level ||
          b.wins - a.wins ||
          a.username.localeCompare(
            b.username
          )
      )
      .slice(0, 20)
      .map(
        (x, i) => ({
          rank: i + 1,
          username: x.username,
          xp: x.xp,
          level: x.level,
          streak: x.streak
        })
      );

  return {
    mode: "xp",
    rows
  };
}

function broadcastLeaderboards() {
  for (
    const mode of [
      "face",
      "hunt",
      "chat",
      "pose",
      "laugh"
    ]
  ) {
    broadcast(
      leaderboardPayload(mode)
    );
  }

  broadcast(
    xpLeaderboardPayload()
  );
}

function endRoom(
  ws,
  notifyOpponent = true
) {
  removeFromWaiting(ws);

  if (!ws.roomId) {
    return null;
  }

  const roomId =
    ws.roomId;

  const room =
    rooms.get(roomId);

  if (!room) {
    ws.roomId = null;
    return null;
  }

  const opponent =
    room.a === ws
      ? room.b
      : room.a;

  if (room.huntTimer) {
    clearTimeout(
      room.huntTimer
    );

    room.huntTimer = null;
  }

  if (room.laughTimer) {
    clearTimeout(
      room.laughTimer
    );

    room.laughTimer = null;
  }

  if (
    room.mode === "chat" &&
    !room.completed
  ) {
    applyGameResult(room);
  }

  if (
    opponent &&
    notifyOpponent
  ) {
    send(
      opponent,
      {
        type: "opponent-left",
        reason: "opponent-left",
        opponentUsername:
          ws.username
      }
    );
  }

  if (room.a) {
    clearSessionRoom(room.a);
    room.a.roomId = null;
  }

  if (room.b) {
    clearSessionRoom(room.b);
    room.b.roomId = null;
  }

  rooms.delete(roomId);

  return opponent;
}

function putInQueue(ws, mode) {
  removeFromWaiting(ws);

  if (ws.readyState !== 1) {
    return;
  }

  ws.queueMode = mode;

  waiting.push(ws);

  send(
    ws,
    {
      type: "waiting",
      mode
    }
  );
}

/*
  IMPORTANT:
  This is random matchmaking.
  It ONLY checks the selected game mode.
  It does NOT check friendships.
*/
function findWaitingOpponent(mode) {
  for (
    let i = 0;
    i < waiting.length;
    i++
  ) {
    const candidate =
      waiting[i];

    if (
      candidate.readyState === 1 &&
      candidate.queueMode === mode
    ) {
      waiting.splice(i, 1);

      candidate.queueMode = null;

      return candidate;
    }
  }

  return null;
}

function scheduleHuntTimeout(room) {
  if (room.huntTimer) {
    clearTimeout(
      room.huntTimer
    );
  }

  room.huntStartedAt =
    Date.now();

  if (room.mode !== "hunt") {
    return;
  }

  room.huntTimer =
    setTimeout(() => {
      if (
        rooms.get(room.id) !== room ||
        room.huntFound
      ) {
        return;
      }

      room.huntFound = true;

      send(
        room.a,
        {
          type: "hunt-timeout",
          round: room.round
        }
      );

      send(
        room.b,
        {
          type: "hunt-timeout",
          round: room.round
        }
      );

      sendNextRound(room);
    }, HUNT_TIMEOUT_MS + 100);
}

function scheduleLaughTimeout(room) {
  if (room.laughTimer) {
    clearTimeout(
      room.laughTimer
    );
  }

  if (room.mode !== "laugh") {
    return;
  }

  room.laughTimer =
    setTimeout(() => {
      if (
        rooms.get(room.id) !== room ||
        room.completed ||
        room.laughScored
      ) {
        return;
      }

      room.laughScored = true;

      send(
        room.a,
        {
          type: "laugh-timeout",
          round: room.round
        }
      );

      send(
        room.b,
        {
          type: "laugh-timeout",
          round: room.round
        }
      );

      sendNextRound(room);
    }, LAUGH_TIMEOUT_MS);
}

function startMatch(
  playerA,
  playerB,
  mode
) {
  const roomId =
    createId();

  const poseTargets = [
    "🕺",
    "🙆‍♂️",
    "🙋‍♂️",
    "💪",
    "🧍‍♂️",
    "🤸"
  ];

  const usedTargets =
    new Set();

  const target =
    mode === "hunt"
      ? nextHuntTarget(
          usedTargets
        )
      : mode === "face"
        ? nextUnique(
            EMOJIS,
            usedTargets
          )
        : mode === "pose"
          ? randomItem(
              poseTargets
            )
          : null;

  const rounds =
    modeRounds(mode);

  const room = {
    id: roomId,

    a: playerA,

    b: playerB,

    mode,

    round: 1,

    totalRounds: rounds,

    target,

    usedTargets,

    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },

    roundScores: {},

    bestFaceRound: {},

    perfectFace: {
      [playerA.playerId]: true,
      [playerB.playerId]: true
    },

    nextReady: new Set(),

    rematchReady: new Set(),

    skipReady: new Set(),

    huntFound: false,

    laughScored: false,

    completed: false,

    huntTimer: null,

    laughTimer: null,

    huntStartedAt: null
  };

  rooms.set(
    roomId,
    room
  );

  playerA.roomId =
    roomId;

  playerB.roomId =
    roomId;

  playerA.role = "a";
  playerB.role = "b";

  playerA.queueMode = null;
  playerB.queueMode = null;

  saveSession(playerA);
  saveSession(playerB);

  const base = {
    type: "matched",
    roomId,
    round: 1,
    totalRounds: rounds,
    mode,
    target
  };

  send(
    playerA,
    {
      ...base,
      role: "a",
      opponentId:
        playerB.playerId,
      opponentUsername:
        playerB.username
    }
  );

  send(
    playerB,
    {
      ...base,
      role: "b",
      opponentId:
        playerA.playerId,
      opponentUsername:
        playerA.username
    }
  );

  scheduleHuntTimeout(room);
  scheduleLaughTimeout(room);
}

function sendNextRound(room) {
  if (
    room.round >=
    room.totalRounds
  ) {
    recordCompletedGame(room);

    send(
      room.a,
      {
        type: "game-over",
        mode: room.mode,
        finalScores:
          room.scores
      }
    );

    send(
      room.b,
      {
        type: "game-over",
        mode: room.mode,
        finalScores:
          room.scores
      }
    );

    return;
  }

  room.round += 1;

  room.nextReady.clear();

  room.huntFound = false;

  room.laughScored = false;

  room.roundScores = {};

  room.target =
    room.mode === "hunt"
      ? nextHuntTarget(
          room.usedTargets
        )
      : room.mode === "face"
        ? nextUnique(
            EMOJIS,
            room.usedTargets
          )
        : room.mode === "pose"
          ? randomItem([
              "🕺",
              "🙆‍♂️",
              "🙋‍♂️",
              "💪",
              "🧍‍♂️",
              "🤸"
            ])
          : null;

  const message = {
    type: "new-round",
    round: room.round,
    totalRounds:
      room.totalRounds,
    mode: room.mode,
    target: room.target
  };

  send(
    room.a,
    message
  );

  send(
    room.b,
    message
  );

  scheduleHuntTimeout(room);
  scheduleLaughTimeout(room);
}

const HEARTBEAT_INTERVAL = 10000;

const heartbeatTimer =
  setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {}

        continue;
      }

      ws.isAlive = false;

      try {
        ws.ping();
      } catch {}
    }
  }, HEARTBEAT_INTERVAL);

wss.on(
  "connection",
  ws => {
    ws.isAlive = true;

    ws.on(
      "pong",
      () => {
        ws.isAlive = true;
      }
    );

    clients.add(ws);

    ws.playerId =
      createId();

    ws.sessionId = null;

    ws.roomId = null;

    ws.role = null;

    ws.queueMode = null;

    ws.username = "Guest";

    ws.explicitLeave = false;

    send(
      ws,
      {
        type: "ready",
        playerId:
          ws.playerId,
        username:
          ws.username
      }
    );

    send(
      ws,
      onlinePayload()
    );

    broadcastOnline();

    ws.on(
      "message",
      raw => {
        let message;

        try {
          message =
            JSON.parse(
              raw.toString()
            );
        } catch {
          return;
        }

        /*
          SET USERNAME / RESTORE SESSION
        */
        if (
          message.type ===
          "set-username"
        ) {
          const oldName =
            ws.username;

          const incomingSession =
            sessionKey(
              message.sessionId
            );

          ws.username =
            cleanName(
              message.username
            );

          ws.sessionId =
            incomingSession ||
            createId();

          /*
            If this session already belongs
            to a room, restore that exact player
            into that room.
          */
          const saved =
            sessions.get(
              ws.sessionId
            );

          if (
            saved?.roomId &&
            rooms.has(
              saved.roomId
            )
          ) {
            const room =
              rooms.get(
                saved.roomId
              );

            const oldPlayer =
              room.a?.playerId ===
              saved.playerId
                ? room.a
                : room.b?.playerId ===
                    saved.playerId
                  ? room.b
                  : null;

            if (oldPlayer) {
              if (
                room.a ===
                oldPlayer
              ) {
                room.a = ws;
              } else {
                room.b = ws;
              }

              ws.playerId =
                saved.playerId;

              ws.roomId =
                room.id;

              ws.role =
                saved.role ||
                (
                  room.a === ws
                    ? "a"
                    : "b"
                );

              ws.queueMode =
                null;

              saved.username =
                ws.username;

              saved.playerId =
                ws.playerId;

              saved.roomId =
                room.id;

              saved.role =
                ws.role;

              send(
                ws,
                {
                  type:
                    "username-saved",
                  username:
                    ws.username
                }
              );

              send(
                ws,
                profilePayload(
                  ws.username
                )
              );

              sendRoomState(
                ws,
                room
              );

              const opponent =
                room.a === ws
                  ? room.b
                  : room.a;

              if (opponent) {
                send(
                  opponent,
                  {
                    type:
                      "opponent-reconnected",
                    opponentUsername:
                      ws.username
                  }
                );
              }

              if (
                oldName !==
                ws.username
              ) {
                broadcastOnline();

                sendFriends(
                  oldName
                );

                sendFriends(
                  ws.username
                );
              }

              return;
            }
          }

          /*
            Existing session but no room.
          */
          const existing =
            sessions.get(
              ws.sessionId
            );

          if (existing) {
            ws.playerId =
              existing.playerId ||
              ws.playerId;

            existing.playerId =
              ws.playerId;

            existing.username =
              ws.username;
          } else {
            sessions.set(
              ws.sessionId,
              {
                playerId:
                  ws.playerId,

                username:
                  ws.username,

                roomId: null,

                role: null
              }
            );
          }

          ensureProfile(
            ws.username
          );

          send(
            ws,
            {
              type:
                "username-saved",
              username:
                ws.username
            }
          );

          send(
            ws,
            profilePayload(
              ws.username
            )
          );

          if (
            oldName !==
            ws.username
          ) {
            broadcastOnline();

            sendFriends(
              oldName
            );

            sendFriends(
              ws.username
            );
          }

          return;
        }

        /*
          FRIENDS
        */
        if (
          message.type ===
          "get-friends"
        ) {
          send(
            ws,
            friendPayload(
              ws.username
            )
          );

          return;
        }

        /*
          SEND FRIEND REQUEST
        */
        if (
          message.type ===
          "friend-request"
        ) {
          const to =
            cleanName(
              message.to
            );

          if (
            !to ||
            to ===
              ws.username
          ) {
            return;
          }

          const target =
            [...clients].find(
              c =>
                c.username ===
                to
            );

          if (!target) {
            send(
              ws,
              {
                type:
                  "friend-result",
                ok: false,
                error:
                  "That player is not online."
              }
            );

            return;
          }

          if (
            isFriend(
              ws.username,
              to
            )
          ) {
            send(
              ws,
              {
                type:
                  "friend-result",
                ok: false,
                error:
                  "You are already friends."
              }
            );

            return;
          }

          ensureSet(
            friendRequests,
            to
          ).add(
            ws.username
          );

          send(
            target,
            {
              type:
                "friend-request-received",
              from:
                ws.username
            }
          );

          send(
            ws,
            {
              type:
                "friend-result",
              ok: true,
              message:
                `Friend request sent to ${to}.`
            }
          );

          sendFriends(to);

          sendFriends(
            ws.username
          );

          return;
        }

        /*
          ACCEPT FRIEND REQUEST
        */
        if (
          message.type ===
          "friend-accept"
        ) {
          const from =
            cleanName(
              message.from
            );

          ensureSet(
            friendRequests,
            ws.username
          ).delete(from);

          ensureSet(
            friends,
            ws.username
          ).add(from);

          ensureSet(
            friends,
            from
          ).add(
            ws.username
          );

          updateDaily(
            ws.username,
            "friend",
            1
          );

          badgeCheck(
            ensureProfile(
              ws.username
            )
          );

          send(
            ws,
            {
              type:
                "friend-result",
              ok: true,
              message:
                `You are now friends with ${from}.`
            }
          );

          sendProfile(
            ws.username
          );

          sendProfile(
            from
          );

          sendFriends(
            ws.username
          );

          sendFriends(
            from
          );

          return;
        }

        /*
          FRIEND INVITE
        */
        if (
          message.type ===
          "friend-invite"
        ) {
          const to =
            cleanName(
              message.to
            );

          const mode =
            [
              "face",
              "chat",
              "hunt",
              "pose",
              "laugh"
            ].includes(
              message.mode
            )
              ? message.mode
              : "face";

          if (
            !to ||
            to ===
              ws.username
          ) {
            return;
          }

          if (
            !isFriend(
              ws.username,
              to
            )
          ) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "You can only invite friends."
              }
            );

            return;
          }

          const target =
            [...clients].find(
              c =>
                c.username ===
                to
            );

          if (!target) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "That friend is offline."
              }
            );

            return;
          }

          if (
            ws.roomId ||
            ws.queueMode
          ) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "Leave your current match before sending an invite."
              }
            );

            return;
          }

          if (
            target.roomId ||
            target.queueMode
          ) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "That friend is already busy."
              }
            );

            return;
          }

          const inviteId =
            createId();

          pendingInvites.set(
            inviteId,
            {
              from:
                ws.username,
              to,
              mode,
              createdAt:
                Date.now()
            }
          );

          send(
            target,
            {
              type:
                "game-invite",
              inviteId,
              from:
                ws.username,
              mode
            }
          );

          send(
            ws,
            {
              type:
                "invite-result",
              ok: true,
              message:
                `Invite sent to ${to}.`
            }
          );

          return;
        }

        /*
          DECLINE INVITE
        */
        if (
          message.type ===
          "decline-invite"
        ) {
          const id =
            String(
              message.inviteId ||
                ""
            );

          const invite =
            pendingInvites.get(
              id
            );

          if (
            !invite ||
            invite.to !==
              ws.username
          ) {
            return;
          }

          pendingInvites.delete(
            id
          );

          const sender =
            [...clients].find(
              c =>
                c.username ===
                invite.from
            );

          if (sender) {
            send(
              sender,
              {
                type:
                  "invite-declined",
                from:
                  ws.username
              }
            );
          }

          return;
        }

        /*
          ACCEPT INVITE
        */
        if (
          message.type ===
          "accept-invite"
        ) {
          const id =
            String(
              message.inviteId ||
                ""
            );

          const invite =
            pendingInvites.get(
              id
            );

          if (
            !invite ||
            invite.to !==
              ws.username
          ) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "That invite is no longer available."
              }
            );

            return;
          }

          if (
            ws.roomId ||
            ws.queueMode
          ) {
            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "You are already in a game."
              }
            );

            return;
          }

          const sender =
            [...clients].find(
              c =>
                c.username ===
                invite.from
            );

          if (
            !sender ||
            sender.roomId ||
            sender.queueMode
          ) {
            pendingInvites.delete(
              id
            );

            send(
              ws,
              {
                type:
                  "invite-result",
                ok: false,
                error:
                  "Your friend is no longer available."
              }
            );

            return;
          }

          pendingInvites.delete(
            id
          );

          startMatch(
            sender,
            ws,
            invite.mode
          );

          broadcastOnline();

          return;
        }

        /*
          DIRECT MESSAGES
        */
        if (
          message.type ===
          "dm"
        ) {
          const to =
            cleanName(
              message.to
            );

          const text =
            String(
              message.text ||
                ""
            )
              .trim()
              .slice(0, 300);

          if (
            !text ||
            !isFriend(
              ws.username,
              to
            )
          ) {
            return;
          }

          addDm(
            ws.username,
            to,
            text
          );

          for (
            const c of clients
          ) {
            if (
              c.username ===
              to
            ) {
              send(
                c,
                {
                  type:
                    "dm",
                  from:
                    ws.username,
                  text,
                  createdAt:
                    new Date().toISOString()
                }
              );
            }
          }

          send(
            ws,
            {
              type: "dm",
              from:
                ws.username,
              text,
              createdAt:
                new Date().toISOString()
            }
          );

          sendDmHistory(
            ws.username,
            to
          );

          sendDmHistory(
            to,
            ws.username
          );

          return;
        }

        if (
          message.type ===
          "get-dm-history"
        ) {
          const to =
            cleanName(
              message.to
            );

          if (
            isFriend(
              ws.username,
              to
            )
          ) {
            sendDmHistory(
              ws.username,
              to
            );
          }

          return;
        }

        /*
          LEADERBOARDS
        */
        if (
          message.type ===
          "get-leaderboards"
        ) {
          for (
            const mode of [
              "face",
              "hunt",
              "chat",
              "pose",
              "laugh"
            ]
          ) {
            send(
              ws,
              leaderboardPayload(
                mode
              )
            );
          }

          send(
            ws,
            xpLeaderboardPayload()
          );

          send(
            ws,
            profilePayload(
              ws.username
            )
          );

          return;
        }

        /*
          REPORT
        */
        if (
          message.type ===
          "report"
        ) {
          const allowedModes = [
            "face",
            "chat",
            "hunt",
            "pose",
            "laugh"
          ];

          const reasons = [
            "harassment",
            "sexual-content",
            "hate",
            "threats",
            "spam",
            "privacy",
            "other"
          ];

          const room =
            ws.roomId
              ? rooms.get(
                  ws.roomId
                )
              : null;

          const mode =
            allowedModes.includes(
              message.mode
            )
              ? message.mode
              : room?.mode;

          if (
            !mode ||
            !room
          ) {
            send(
              ws,
              {
                type:
                  "report-result",
                ok: false,
                error:
                  "You can only report someone while connected to a game."
              }
            );

            return;
          }

          const opponent =
            room.a === ws
              ? room.b
              : room.a;

          if (!opponent) {
            return;
          }

          const reason =
            reasons.includes(
              message.reason
            )
              ? message.reason
              : "other";

          const details =
            String(
              message.details ||
                ""
            )
              .trim()
              .slice(0, 1000);

          const report = {
            id:
              createId(),

            createdAt:
              new Date().toISOString(),

            mode,

            reporterId:
              ws.playerId,

            reporterUsername:
              ws.username,

            reportedId:
              opponent.playerId,

            reportedUsername:
              opponent.username,

            roomId:
              room.id,

            reason,

            details
          };

          reports.push(report);

          if (
            reports.length >
            MAX_REPORTS
          ) {
            reports.shift();
          }

          console.log(
            "EmojiTV REPORT",
            JSON.stringify(
              report
            )
          );

          send(
            ws,
            {
              type:
                "report-result",
              ok: true,
              reportId:
                report.id
            }
          );

          return;
        }

        /*
          RANDOM MATCHMAKING
          
          Friendship is NOT required.

          Two people selecting the same
          mode will be paired.
        */
        if (
          message.type ===
          "find-match"
        ) {
          const mode =
            [
              "face",
              "chat",
              "hunt",
              "pose",
              "laugh"
            ].includes(
              message.mode
            )
              ? message.mode
              : "face";

          if (
            message.username
          ) {
            ws.username =
              cleanName(
                message.username
              );
          }

          /*
            If this player is already
            inside a room, restore that room.
          */
          if (
            ws.roomId &&
            rooms.has(
              ws.roomId
            )
          ) {
            const room =
              rooms.get(
                ws.roomId
              );

            sendRoomState(
              ws,
              room
            );

            return;
          }

          /*
            Make absolutely sure this
            connection isn't sitting in
            an old queue entry.
          */
          removeFromWaiting(ws);

          ws.roomId = null;
          ws.role = null;

          /*
            Find ANY waiting player
            using the SAME GAME MODE.

            No friendship check.
          */
          const opponent =
            findWaitingOpponent(
              mode
            );

          if (opponent) {
            startMatch(
              opponent,
              ws,
              mode
            );

            console.log(
              `MATCH FOUND: ${opponent.username} + ${ws.username} (${mode})`
            );
          } else {
            putInQueue(
              ws,
              mode
            );

            console.log(
              `WAITING: ${ws.username} (${mode})`
            );
          }

          saveSession(ws);

          broadcastOnline();

          return;
        }

        /*
          SKIP CURRENT OPPONENT
        */
        if (
          message.type ===
          "skip"
        ) {
          const oldMode =
            ws.roomId
              ? rooms.get(
                  ws.roomId
                )?.mode
              : ws.queueMode;

          endRoom(
            ws,
            true
          );

          if (oldMode) {
            putInQueue(
              ws,
              oldMode
            );
          }

          broadcastOnline();

          return;
        }

        /*
          LEAVE BUTTON
          
          This is the ONLY normal action
          that permanently ends the room.
        */
        if (
          message.type ===
          "leave"
        ) {
          ws.explicitLeave =
            true;

          endRoom(
            ws,
            true
          );

          if (ws.sessionId) {
            sessions.delete(
              ws.sessionId
            );
          }

          broadcastOnline();

          return;
        }

        /*
          Everything below requires
          an active room.
        */
        if (!ws.roomId) {
          return;
        }

        const room =
          rooms.get(
            ws.roomId
          );

        if (!room) {
          return;
        }

        const opponent =
          room.a === ws
            ? room.b
            : room.a;

        /*
          REMATCH
        */
        if (
          message.type ===
          "rematch-ready"
        ) {
          room.rematchReady.add(
            ws.playerId
          );

          send(
            room.a,
            {
              type:
                "rematch-status",
              ready:
                room.rematchReady.size
            }
          );

          send(
            room.b,
            {
              type:
                "rematch-status",
              ready:
                room.rematchReady.size
            }
          );

          if (
            room.rematchReady.size ===
            2
          ) {
            room.rematchReady.clear();

            room.completed =
              false;

            room.round = 1;

            room.scores = {
              [room.a.playerId]: 0,
              [room.b.playerId]: 0
            };

            room.roundScores = {};

            room.bestFaceRound = {};

            room.perfectFace = {
              [room.a.playerId]:
                true,
              [room.b.playerId]:
                true
            };

            room.nextReady =
              new Set();

            room.huntFound =
              false;

            room.usedTargets =
              new Set();

            room.target =
              room.mode ===
                "hunt"
                ? nextHuntTarget(
                    room.usedTargets
                  )
                : room.mode ===
                    "face"
                  ? nextUnique(
                      EMOJIS,
                      room.usedTargets
                    )
                  : room.mode ===
                      "pose"
                    ? randomItem([
                        "🕺",
                        "🙆‍♂️",
                        "🙋‍♂️",
                        "💪",
                        "🧍‍♂️",
                        "🤸"
                      ])
                    : null;

            room.laughScored =
              false;

            send(
              room.a,
              {
                type:
                  "rematch-started",
                round: 1,
                totalRounds:
                  room.totalRounds,
                mode:
                  room.mode,
                target:
                  room.target
              }
            );

            send(
              room.b,
              {
                type:
                  "rematch-started",
                round: 1,
                totalRounds:
                  room.totalRounds,
                mode:
                  room.mode,
                target:
                  room.target
              }
            );

            scheduleHuntTimeout(
              room
            );

            scheduleLaughTimeout(
              room
            );
          }

          return;
        }

        /*
          HUNT SKIP
        */
        if (
          message.type ===
            "skip-item" &&
          room.mode ===
            "hunt"
        ) {
          if (
            room.huntFound
          ) {
            return;
          }

          room.skipReady.add(
            ws.playerId
          );

          send(
            room.a,
            {
              type:
                "skip-item-status",
              ready:
                room.skipReady.size
            }
          );

          send(
            room.b,
            {
              type:
                "skip-item-status",
              ready:
                room.skipReady.size
            }
          );

          if (
            room.skipReady.size ===
            2
          ) {
            room.skipReady.clear();

            room.huntFound =
              false;

            room.roundScores = {};

            room.target =
              nextHuntTarget(
                room.usedTargets
              );

            send(
              room.a,
              {
                type:
                  "new-round",
                round:
                  room.round,
                totalRounds:
                  room.totalRounds,
                mode:
                  "hunt",
                target:
                  room.target,
                skipped:
                  true
              }
            );

            send(
              room.b,
              {
                type:
                  "new-round",
                round:
                  room.round,
                totalRounds:
                  room.totalRounds,
                mode:
                  "hunt",
                target:
                  room.target,
                skipped:
                  true
              }
            );

            scheduleHuntTimeout(
              room
            );

            scheduleLaughTimeout(
              room
            );
          }

          return;
        }

        /*
          FACE SCORE
        */
        if (
          message.type ===
            "round-score" &&
          room.mode ===
            "face"
        ) {
          const score =
            Math.max(
              0,
              Math.min(
                100,
                Number(
                  message.score
                ) || 0
              )
            );

          room.roundScores[
            ws.playerId
          ] = score;

          room.bestFaceRound =
            room.bestFaceRound ||
            {};

          room.bestFaceRound[
            ws.playerId
          ] =
            Math.max(
              room.bestFaceRound[
                ws.playerId
              ] || 0,
              score
            );

          room.perfectFace =
            room.perfectFace ||
            {};

          if (
            score < 100
          ) {
            room.perfectFace[
              ws.playerId
            ] = false;
          }

          room.scores[
            ws.playerId
          ] =
            (room.scores[
              ws.playerId
            ] || 0) +
            score;

          send(
            ws,
            {
              type:
                "your-score",
              score,
              totalScore:
                room.scores[
                  ws.playerId
                ],
              round:
                room.round
            }
          );

          send(
            opponent,
            {
              type:
                "opponent-score",
              score,
              totalScore:
                room.scores[
                  ws.playerId
                ],
              round:
                room.round
            }
          );

          return;
        }

        /*
          POSE SCORE
        */
        if (
          message.type ===
            "pose-score" &&
          room.mode ===
            "pose"
        ) {
          const score =
            Math.max(
              0,
              Math.min(
                100,
                Number(
                  message.score
                ) || 0
              )
            );

          room.roundScores[
            ws.playerId
          ] = score;

          room.scores[
            ws.playerId
          ] =
            (room.scores[
              ws.playerId
            ] || 0) +
            score;

          send(
            ws,
            {
              type:
                "your-score",
              score,
              totalScore:
                room.scores[
                  ws.playerId
                ],
              round:
                room.round
            }
          );

          send(
            opponent,
            {
              type:
                "pose-score",
              score,
              opponentId:
                ws.playerId,
              totalScore:
                room.scores[
                  ws.playerId
                ],
              round:
                room.round
            }
          );

          return;
        }

        /*
          LAUGH
        */
        if (
          message.type ===
            "laugh" &&
          room.mode ===
            "laugh" &&
          !room.laughScored
        ) {
          room.laughScored =
            true;

          if (
            room.laughTimer
          ) {
            clearTimeout(
              room.laughTimer
            );

            room.laughTimer =
              null;
          }

          room.scores[
            ws.playerId
          ] =
            (room.scores[
              ws.playerId
            ] || 0) +
            1;

          send(
            ws,
            {
              type:
                "laugh-you-laughed",
              scores:
                room.scores,
              round:
                room.round
            }
          );

          send(
            opponent,
            {
              type:
                "laugh-point",
              from:
                ws.username,
              opponentId:
                ws.playerId,
              scores:
                room.scores,
              round:
                room.round
            }
          );

          setTimeout(
            () => {
              if (
                rooms.get(
                  room.id
                ) === room
              ) {
                sendNextRound(
                  room
                );
              }
            },
            1400
          );

          return;
        }

        /*
          HUNT TIMEOUT
        */
        if (
          message.type ===
            "hunt-timeout" &&
          room.mode ===
            "hunt" &&
          !room.huntFound
        ) {
          if (
            !room.huntStartedAt ||
            Date.now() -
              room.huntStartedAt <
              HUNT_TIMEOUT_MS
          ) {
            return;
          }

          room.huntFound =
            true;

          if (
            room.huntTimer
          ) {
            clearTimeout(
              room.huntTimer
            );

            room.huntTimer =
              null;
          }

          send(
            room.a,
            {
              type:
                "hunt-timeout",
              round:
                room.round
            }
          );

          send(
            room.b,
            {
              type:
                "hunt-timeout",
              round:
                room.round
            }
          );

          sendNextRound(
            room
          );

          return;
        }

        /*
          HUNT FOUND
        */
        if (
          message.type ===
            "hunt-found" &&
          room.mode ===
            "hunt" &&
          !room.huntFound
        ) {
          if (
            !room.huntStartedAt ||
            Date.now() -
              room.huntStartedAt >
              HUNT_TIMEOUT_MS
          ) {
            return;
          }

          room.huntFound =
            true;

          if (
            room.huntTimer
          ) {
            clearTimeout(
              room.huntTimer
            );

            room.huntTimer =
              null;
          }

          room.scores[
            ws.playerId
          ] += 1;

          send(
            room.a,
            {
              type:
                "hunt-winner",
              winnerId:
                ws.playerId,
              round:
                room.round,
              scores:
                room.scores
            }
          );

          send(
            room.b,
            {
              type:
                "hunt-winner",
              winnerId:
                ws.playerId,
              round:
                room.round,
              scores:
                room.scores
            }
          );

          setTimeout(
            () => {
              if (
                rooms.get(
                  room.id
                ) === room
              ) {
                sendNextRound(
                  room
                );
              }
            },
            2200
          );

          return;
        }

        /*
          NEXT ROUND
        */
        if (
          message.type ===
            "next-round" &&
          (
            room.mode ===
              "face" ||
            room.mode ===
              "pose"
          )
        ) {
          room.nextReady.add(
            ws.playerId
          );

          if (
            room.nextReady.size ===
            2
          ) {
            sendNextRound(
              room
            );
          }

          return;
        }

        /*
          CHAT
        */
        if (
          message.type ===
            "chat-message" &&
          room.mode ===
            "chat"
        ) {
          const text =
            String(
              message.text ||
                ""
            ).slice(0, 300);

          if (text) {
            send(
              opponent,
              {
                type:
                  "chat-message",
                text
              }
            );

            send(
              ws,
              {
                type:
                  "chat-message",
                text,
                self: true
              }
            );
          }

          return;
        }

        /*
          WEBRTC SIGNALING
          
          This passes offers, answers,
          and ICE candidates between
          the two random players.
        */
        if (
          message.type ===
            "signal" &&
          opponent
        ) {
          send(
            opponent,
            {
              type:
                "signal",
              signal:
                message.signal,
              from:
                ws.playerId
            }
          );

          return;
        }
      }
    );

    /*
      CONNECTION CLOSED
    */
    ws.on(
      "close",
      () => {
        clients.delete(ws);

        removeFromWaiting(ws);

        /*
          VERY IMPORTANT:
          Do NOT destroy the room when a
          browser temporarily disconnects.

          The other player stays in the game.
          The disconnected player can reconnect
          using the same session ID.
        */
        if (
          ws.roomId &&
          rooms.has(
            ws.roomId
          ) &&
          !ws.explicitLeave
        ) {
          const room =
            rooms.get(
              ws.roomId
            );

          saveSession(ws);

          const opponent =
            room.a === ws
              ? room.b
              : room.a;

          if (opponent) {
            send(
              opponent,
              {
                type:
                  "opponent-temporarily-disconnected",
                opponentUsername:
                  ws.username
              }
            );
          }
        }

        /*
          Remove invites belonging
          to this username.
        */
        for (
          const [
            id,
            invite
          ] of pendingInvites
        ) {
          if (
            invite.from ===
              ws.username ||
            invite.to ===
              ws.username
          ) {
            pendingInvites.delete(
              id
            );
          }
        }

        broadcastOnline();

        for (
          const name of ensureSet(
            friends,
            ws.username
          )
        ) {
          sendFriends(name);
        }
      }
    );
  }
);

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `EmojiTV running on port ${PORT}`
    );
  }
);
