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

const PORT = process.env.PORT || 3000;

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
  "😱","😖","😣","😩","🥺","🥹","😤","😠","😡","🤬",
  "🤯","😮","😲","😵‍💫","😱","🤔","🤫","🤭","🫢","🫣"
];

const POSES = [
  "🕺",
  "🙆‍♂️",
  "🙋‍♂️",
  "💪",
  "🧍‍♂️",
  "🤸"
];

const HUNT_ITEMS = [
  "phone",
  "cup",
  "bottle",
  "book",
  "headphones",
  "keyboard",
  "mouse",
  "backpack",
  "hat",
  "shoe",
  "pillow",
  "chair",
  "controller",
  "plant",
  "lamp",
  "glasses",
  "remote",
  "water bottle",
  "stuffed animal",
  "ball"
];

const LAUGH_ROUNDS = 3;
const POSE_ROUNDS = 5;
const FACE_ROUNDS = 5;
const HUNT_ROUNDS = 5;

function safeSend(ws, payload) {
  if (!ws) return;

  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  } catch {}
}

function send(username, payload) {
  for (const ws of clients) {
    if (ws.username === username) {
      safeSend(ws, payload);
    }
  }
}

function broadcast(payload) {
  for (const ws of clients) {
    safeSend(ws, payload);
  }
}

function getClientByPlayerId(playerId) {
  for (const ws of clients) {
    if (ws.__playerId === playerId) return ws;
  }
  return null;
}

function getRoomPlayer(room, playerId) {
  if (!room) return null;
  if (room.a?.playerId === playerId) return room.a;
  if (room.b?.playerId === playerId) return room.b;
  return null;
}

function otherPlayer(room, playerId) {
  if (!room) return null;
  if (room.a?.playerId === playerId) return room.b;
  if (room.b?.playerId === playerId) return room.a;
  return null;
}

function roomHasPlayer(room, playerId) {
  return !!getRoomPlayer(room, playerId);
}

function removeFromWaiting(ws) {
  const index = waiting.indexOf(ws);
  if (index !== -1) waiting.splice(index, 1);
}

function modeName(mode) {
  if (mode === "face") return "Face-Off";
  if (mode === "hunt") return "Emoji Hunt";
  if (mode === "chat") return "Video Chat";
  if (mode === "pose") return "Copy the Pose";
  if (mode === "laugh") return "Make Them Laugh";
  return mode;
}

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function randomPose() {
  return POSES[Math.floor(Math.random() * POSES.length)];
}

function randomHuntItem() {
  return HUNT_ITEMS[Math.floor(Math.random() * HUNT_ITEMS.length)];
}

function ensureFriends(username) {
  if (!friends.has(username)) {
    friends.set(username, new Set());
  }
  return friends.get(username);
}

function ensureRequests(username) {
  if (!friendRequests.has(username)) {
    friendRequests.set(username, new Set());
  }
  return friendRequests.get(username);
}

function ensureProfile(username) {
  if (!profiles.has(username)) {
    profiles.set(username, {
      username,
      xp: 0,
      level: 1,
      gamesPlayed: 0,
      wins: 0,
      streak: 0,
      bestStreak: 0,
      badges: new Set(),
      daily: {
        date: new Date().toISOString().slice(0, 10),
        challenges: [],
        progress: {},
        completed: []
      }
    });
  }

  const p = profiles.get(username);

  resetDailyIfNeeded(p);

  return p;
}

function resetDailyIfNeeded(profile) {
  const today = new Date().toISOString().slice(0, 10);

  if (profile.daily?.date === today) return;

  profile.daily = {
    date: today,
    challenges: [],
    progress: {},
    completed: []
  };
}

function getDailyChallenges(profile) {
  if (!profile.daily.challenges.length) {
    const shuffled = [...DAILY_CHALLENGES].sort(() => Math.random() - 0.5);

    profile.daily.challenges = shuffled
      .slice(0, 3)
      .map(c => ({ ...c }));

    for (const c of profile.daily.challenges) {
      profile.daily.progress[c.id] = 0;
    }
  }

  return profile.daily.challenges.map(c => ({
    ...c,
    progress: profile.daily.progress[c.id] || 0,
    completed: profile.daily.completed.includes(c.id)
  }));
}

function addXp(profile, amount) {
  profile.xp += Math.max(0, amount);

  profile.level =
    Math.floor(profile.xp / XP_PER_LEVEL) + 1;
}

function updateDaily(username, event, amount = 1) {
  const p = ensureProfile(username);
  const challenges = getDailyChallenges(p);

  let changed = false;

  for (const c of challenges) {
    if (c.event !== event) continue;
    if (p.daily.completed.includes(c.id)) continue;

    const current = p.daily.progress[c.id] || 0;

    const next =
      event === "streak"
        ? Math.max(current, amount)
        : current + amount;

    p.daily.progress[c.id] =
      Math.min(c.target, next);

    changed = true;

    if (p.daily.progress[c.id] >= c.target) {
      p.daily.completed.push(c.id);

      addXp(p, c.reward);

      send(p.username, {
        type: "daily-complete",
        challengeId: c.id,
        title: c.title,
        reward: c.reward
      });
    }
  }

  return changed;
}

function badgeCheck(profile) {
  if (profile.gamesPlayed >= 1) {
    profile.badges.add("first-win");
  }

  if (profile.bestStreak >= 5) {
    profile.badges.add("streak-5");
  }

  if (profile.bestStreak >= 10) {
    profile.badges.add("streak-10");
  }

  if (profile.gamesPlayed >= 100) {
    profile.badges.add("games-100");
  }

  if (ensureFriends(profile.username).size >= 10) {
    profile.badges.add("friends-10");
  }
}

function profilePayload(username) {
  const p = ensureProfile(username);

  const xpIntoLevel =
    p.xp % XP_PER_LEVEL;

  return {
    type: "profile",
    username: p.username,
    xp: p.xp,
    level: p.level,
    xpIntoLevel,
    xpToNextLevel:
      XP_PER_LEVEL - xpIntoLevel,
    gamesPlayed: p.gamesPlayed,
    wins: p.wins,
    streak: p.streak,
    bestStreak: p.bestStreak,
    badges: [...p.badges],
    daily: {
      date: p.daily.date,
      challenges: getDailyChallenges(p)
    }
  };
}

function sendProfile(username) {
  send(username, profilePayload(username));
}

function updateProfileAndSend(username) {
  const p = ensureProfile(username);

  badgeCheck(p);

  sendProfile(username);
}

function ensureStats(mode, username) {
  if (!leaderboard[mode]) {
    leaderboard[mode] = new Map();
  }

  if (!leaderboard[mode].has(username)) {
    leaderboard[mode].set(username, {
      username,
      wins: 0,
      games: 0,
      points: 0
    });
  }

  return leaderboard[mode].get(username);
}

function applyGameResult(room) {
  if (!room || room.completed) return null;

  room.completed = true;

  const players = [room.a, room.b];

  const scores = room.scores;

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
      ensureStats(room.mode, player.username);

    stats.games += 1;

    stats.points +=
      scores[player.playerId] || 0;

    const p =
      ensureProfile(player.username);

    p.gamesPlayed += 1;

    const won =
      winnerIds.has(player.playerId);

    if (won) {
      stats.wins += 1;

      p.wins += 1;

      p.streak += 1;

      p.bestStreak =
        Math.max(
          p.bestStreak,
          p.streak
        );
    } else if (room.mode !== "chat") {
      p.streak = 0;
    }

    let xp =
      room.mode === "chat"
        ? 25
        : 30;

    if (won) xp += 100;

    if (room.mode === "face") {
      xp += Math.min(
        50,
        Math.floor(
          (scores[player.playerId] || 0) / 10
        )
      );
    }

    if (room.mode === "hunt") {
      xp +=
        (scores[player.playerId] || 0) * 10;
    }

    if (room.mode === "pose") {
      xp += Math.min(
        50,
        Math.floor(
          (scores[player.playerId] || 0) / 10
        )
      );
    }

    if (room.mode === "laugh") {
      xp +=
        (scores[player.playerId] || 0) * 40;
    }

    addXp(p, xp);

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
      (room.bestFaceRound?.[player.playerId] || 0) >= 80
    ) {
      updateDaily(
        player.username,
        "score80",
        1
      );
    }

    if (
      room.mode === "face" &&
      room.perfectFace?.[player.playerId]
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
        p.streak
      );
    }

    badgeCheck(p);
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
          a.username.localeCompare(b.username)
      )
      .slice(0, 10);

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
          a.username.localeCompare(b.username)
      )
      .slice(0, 10)
      .map(p => ({
        username: p.username,
        xp: p.xp,
        level: p.level
      }));

  return {
    mode: "xp",
    rows
  };
}

function broadcastLeaderboards() {
  for (const ws of clients) {
    safeSend(ws, {
      type: "leaderboards",
      data: {
        face: leaderboardPayload("face"),
        hunt: leaderboardPayload("hunt"),
        chat: leaderboardPayload("chat"),
        pose: leaderboardPayload("pose"),
        laugh: leaderboardPayload("laugh"),
        xp: xpLeaderboardPayload()
      }
    });
  }
}

function friendPayload(username) {
  const f =
    [...ensureFriends(username)];

  const pending =
    [...ensureRequests(username)];

  const online =
    f.filter(name =>
      [...clients].some(
        c => c.username === name
      )
    );

  return {
    type: "friends",
    friends: f,
    pending,
    online
  };
}

function sendFriends(username) {
  send(
    username,
    friendPayload(username)
  );
}

function addFriend(a, b) {
  if (!a || !b || a === b) return false;

  ensureFriends(a).add(b);
  ensureFriends(b).add(a);

  ensureRequests(a).delete(b);
  ensureRequests(b).delete(a);

  updateDaily(a, "friend", 1);
  updateDaily(b, "friend", 1);

  badgeCheck(ensureProfile(a));
  badgeCheck(ensureProfile(b));

  sendFriends(a);
  sendFriends(b);

  updateProfileAndSend(a);
  updateProfileAndSend(b);

  return true;
}

function sendRoomState(room) {
  if (!room) return;

  for (const player of [room.a, room.b]) {
    const ws = getClientByPlayerId(
      player.playerId
    );

    if (!ws) continue;

    const opponent =
      otherPlayer(
        room,
        player.playerId
      );

    safeSend(ws, {
      type: "session-restored",
      mode: room.mode,
      roomId: room.id,
      playerId: player.playerId,
      opponentId: opponent?.playerId,
      opponentUsername:
        opponent?.username || "PLAYER",
      role: player.role,
      round: room.round,
      totalRounds: room.totalRounds,
      target: room.target,
      scores: room.scores
    });
  }
}

function endRoom(room) {
  if (!room) return;

  rooms.delete(room.id);

  for (const player of [room.a, room.b]) {
    if (
      sessions.get(player.sessionId)
        ?.roomId === room.id
    ) {
      sessions.delete(
        player.sessionId
      );
    }

    const ws =
      getClientByPlayerId(
        player.playerId
      );

    if (ws) {
      ws.__roomId = null;

      safeSend(ws, {
        type: "game-ended"
      });
    }
  }
}

function createRoom(a, b, mode) {
  const roomId =
    crypto.randomUUID();

  const playerA = {
    playerId:
      crypto.randomUUID(),
    username:
      a.username,
    sessionId:
      a.sessionId,
    role: "a"
  };

  const playerB = {
    playerId:
      crypto.randomUUID(),
    username:
      b.username,
    sessionId:
      b.sessionId,
    role: "b"
  };

  const totalRounds =
    mode === "face"
      ? FACE_ROUNDS
      : mode === "pose"
      ? POSE_ROUNDS
      : mode === "laugh"
      ? LAUGH_ROUNDS
      : mode === "hunt"
      ? HUNT_ROUNDS
      : 1;

  const room = {
    id: roomId,
    mode,
    a: playerA,
    b: playerB,
    round: 1,
    totalRounds,
    target:
      mode === "face"
        ? randomEmoji()
        : mode === "pose"
        ? randomPose()
        : mode === "hunt"
        ? randomHuntItem()
        : null,
    scores: {
      [playerA.playerId]: 0,
      [playerB.playerId]: 0
    },
    roundScores: {},
    bestFaceRound: {},
    perfectFace: {},
    completed: false,
    disconnected: new Set(),
    timers: {}
  };

  rooms.set(roomId, room);

  a.__roomId = roomId;
  b.__roomId = roomId;

  a.__playerId =
    playerA.playerId;

  b.__playerId =
    playerB.playerId;

  sessions.set(
    playerA.sessionId,
    {
      roomId,
      playerId:
        playerA.playerId,
      username:
        playerA.username
    }
  );

  sessions.set(
    playerB.sessionId,
    {
      roomId,
      playerId:
        playerB.playerId,
      username:
        playerB.username
    }
  );

  safeSend(a, {
    type: "matched",
    mode,
    roomId,
    role: "a",
    playerId:
      playerA.playerId,
    opponentId:
      playerB.playerId,
    opponentUsername:
      playerB.username,
    round: 1,
    totalRounds,
    target: room.target
  });

  safeSend(b, {
    type: "matched",
    mode,
    roomId,
    role: "b",
    playerId:
      playerB.playerId,
    opponentId:
      playerA.playerId,
    opponentUsername:
      playerA.username,
    round: 1,
    totalRounds,
    target: room.target
  });

  startRoundTimer(room);

  return room;
}

function startMatch(a, b, mode) {
  removeFromWaiting(a);
  removeFromWaiting(b);

  return createRoom(
    a,
    b,
    mode
  );
}

function startRoundTimer(room) {
  if (!room) return;

  if (room.timers.round) {
    clearTimeout(
      room.timers.round
    );
  }

  let seconds =
    room.mode === "face"
      ? 15
      : room.mode === "pose"
      ? 15
      : room.mode === "laugh"
      ? 30
      : room.mode === "hunt"
      ? 60
      : 0;

  if (!seconds) return;

  room.timers.round =
    setTimeout(() => {
      finishRound(room);
    }, seconds * 1000);
}

function nextTarget(room) {
  if (room.mode === "face") {
    return randomEmoji();
  }

  if (room.mode === "pose") {
    return randomPose();
  }

  if (room.mode === "hunt") {
    return randomHuntItem();
  }

  return null;
}

function finishRound(room) {
  if (!room || room.completed) return;

  const players =
    [room.a, room.b];

  if (room.mode === "chat") {
    const result =
      recordCompletedGame(room);

    for (const player of players) {
      safeSend(
        getClientByPlayerId(
          player.playerId
        ),
        {
          type: "game-result",
          mode: room.mode,
          yourScore:
            room.scores[player.playerId] || 0,
          opponentScore:
            room.scores[
              otherPlayer(
                room,
                player.playerId
              )?.playerId
            ] || 0,
          tie:
            result?.winnerIds?.size === 0
        }
      );
    }

    return;
  }

  room.roundScores =
    room.roundScores || {};

  room.roundScores[room.round] =
    { ...room.scores };

  if (
    room.round >=
    room.totalRounds
  ) {
    const result =
      recordCompletedGame(room);

    for (const player of players) {
      const ws =
        getClientByPlayerId(
          player.playerId
        );

      safeSend(ws, {
        type: "game-result",
        mode: room.mode,
        yourScore:
          room.scores[player.playerId] || 0,
        opponentScore:
          room.scores[
            otherPlayer(
              room,
              player.playerId
            )?.playerId
          ] || 0,
        tie:
          result?.winnerIds?.size === 0
      });
    }

    return;
  }

  room.round += 1;

  room.target =
    nextTarget(room);

  room.scores = {
    [room.a.playerId]:
      room.scores[room.a.playerId] || 0,
    [room.b.playerId]:
      room.scores[room.b.playerId] || 0
  };

  for (const player of players) {
    const ws =
      getClientByPlayerId(
        player.playerId
      );

    if (!ws) continue;

    safeSend(ws, {
      type: "new-round",
      mode: room.mode,
      round: room.round,
      totalRounds:
        room.totalRounds,
      target: room.target
    });
  }

  startRoundTimer(room);
}

function requeueAfterSkip(ws) {
  if (!ws) return;

  const mode =
    ws.__mode;

  if (!mode) return;

  removeFromWaiting(ws);

  ws.__roomId = null;

  waiting.push(ws);

  safeSend(ws, {
    type: "waiting",
    mode,
    message:
      "Looking for another player..."
  });

  tryMatch(mode);
}

function tryMatch(mode) {
  const eligible =
    waiting.filter(
      ws =>
        ws.__mode === mode &&
        ws.readyState === 1
    );

  while (eligible.length >= 2) {
    const a =
      eligible.shift();

    const b =
      eligible.shift();

    const ia =
      waiting.indexOf(a);

    if (ia !== -1)
      waiting.splice(ia, 1);

    const ib =
      waiting.indexOf(b);

    if (ib !== -1)
      waiting.splice(ib, 1);

    if (
      a === b ||
      a.readyState !== 1 ||
      b.readyState !== 1
    ) {
      if (
        a.readyState === 1 &&
        a !== b
      ) {
        waiting.push(a);
      }

      if (
        b.readyState === 1
      ) {
        waiting.push(b);
      }

      continue;
    }

    startMatch(
      a,
      b,
      mode
    );
  }
}

function findMatch(ws, mode) {
  ws.__mode = mode;

  const existingSession =
    sessions.get(
      ws.sessionId
    );

  if (existingSession) {
    const room =
      rooms.get(
        existingSession.roomId
      );

    if (
      room &&
      roomHasPlayer(
        room,
        existingSession.playerId
      )
    ) {
      ws.__playerId =
        existingSession.playerId;

      ws.__roomId =
        room.id;

      sendRoomState(room);

      return;
    }
  }

  removeFromWaiting(ws);

  ws.__roomId = null;

  for (const room of rooms.values()) {
    if (
      room.mode === mode &&
      roomHasPlayer(
        room,
        ws.__playerId
      )
    ) {
      ws.__roomId = room.id;

      sendRoomState(room);

      return;
    }
  }

  waiting.push(ws);

  safeSend(ws, {
    type: "waiting",
    mode,
    message:
      "Looking for another player..."
  });

  tryMatch(mode);
}

function handleFaceScore(ws, message) {
  const room =
    rooms.get(ws.__roomId);

  if (!room) return;

  if (
    room.mode !== "face" ||
    room.completed
  ) return;

  const score =
    Math.max(
      0,
      Math.min(
        100,
        Number(message.score) || 0
      )
    );

  room.scores[
    ws.__playerId
  ] =
    Math.max(
      room.scores[
        ws.__playerId
      ] || 0,
      score
    );

  room.bestFaceRound =
    room.bestFaceRound || {};

  room.bestFaceRound[
    ws.__playerId
  ] =
    Math.max(
      room.bestFaceRound[
        ws.__playerId
      ] || 0,
      score
    );

  if (score >= 98) {
    room.perfectFace =
      room.perfectFace || {};

    room.perfectFace[
      ws.__playerId
    ] = true;
  }

  safeSend(
    getClientByPlayerId(
      ws.__playerId
    ),
    {
      type: "your-score",
      score
    }
  );

  finishRoundIfBothScored(room);
}

function finishRoundIfBothScored(room) {
  if (!room) return;

  const aScore =
    room.scores[
      room.a.playerId
    ];

  const bScore =
    room.scores[
      room.b.playerId
    ];

  if (
    typeof aScore !== "number" ||
    typeof bScore !== "number"
  ) {
    return;
  }

  if (
    room.mode === "face" ||
    room.mode === "pose"
  ) {
    const bothHaveScores =
      aScore >= 0 &&
      bScore >= 0;

    if (bothHaveScores) {
      setTimeout(() => {
        if (
          rooms.has(room.id) &&
          !room.completed
        ) {
          finishRound(room);
        }
      }, 700);
    }
  }
}

function handlePoseScore(ws, message) {
  const room =
    rooms.get(ws.__roomId);

  if (!room) return;

  if (
    room.mode !== "pose" ||
    room.completed
  ) return;

  const score =
    Math.max(
      0,
      Math.min(
        100,
        Number(message.score) || 0
      )
    );

  room.scores[
    ws.__playerId
  ] =
    Math.max(
      room.scores[
        ws.__playerId
      ] || 0,
      score
    );

  finishRoundIfBothScored(room);
}

function handleHuntFound(ws) {
  const room =
    rooms.get(ws.__roomId);

  if (!room) return;

  if (
    room.mode !== "hunt" ||
    room.completed
  ) return;

  room.scores[
    ws.__playerId
  ] =
    (room.scores[
      ws.__playerId
    ] || 0) + 1;

  for (const player of [
    room.a,
    room.b
  ]) {
    safeSend(
      getClientByPlayerId(
        player.playerId
      ),
      {
        type: "hunt-found",
        playerId:
          ws.__playerId,
        username:
          ws.username,
        scores:
          room.scores
      }
    );
  }

  finishRound(room);
}

function handleLaugh(ws) {
  const room =
    rooms.get(ws.__roomId);

  if (!room) return;

  if (
    room.mode !== "laugh" ||
    room.completed
  ) return;

  const opponent =
    otherPlayer(
      room,
      ws.__playerId
    );

  if (!opponent) return;

  room.scores[
    opponent.playerId
  ] =
    (room.scores[
      opponent.playerId
    ] || 0) + 1;

  for (const player of [
    room.a,
    room.b
  ]) {
    safeSend(
      getClientByPlayerId(
        player.playerId
      ),
      {
        type: "laugh-scored",
        playerId:
          opponent.playerId,
        username:
          opponent.username,
        scores:
          room.scores
      }
    );
  }

  finishRound(room);
}

function handleChatMessage(ws, message) {
  const room =
    rooms.get(ws.__roomId);

  if (!room) return;

  if (
    room.mode !== "chat" ||
    room.completed
  ) return;

  const text =
    String(message.text || "")
      .slice(0, 500);

  if (!text) return;

  const opponent =
    otherPlayer(
      room,
      ws.__playerId
    );

  if (!opponent) return;

  safeSend(
    getClientByPlayerId(
      opponent.playerId
    ),
    {
      type: "chat-message",
      username:
        ws.username,
      text
    }
  );
}

function explicitLeave(ws) {
  removeFromWaiting(ws);

  const room =
    rooms.get(ws.__roomId);

  if (room) {
    const opponent =
      otherPlayer(
        room,
        ws.__playerId
      );

    if (opponent) {
      const opponentWs =
        getClientByPlayerId(
          opponent.playerId
        );

      safeSend(
        opponentWs,
        {
          type: "opponent-left"
        }
      );
    }

    endRoom(room);
  }

  if (ws.sessionId) {
    sessions.delete(
      ws.sessionId
    );
  }

  ws.__roomId = null;
}

wss.on("connection", ws => {
  clients.add(ws);

  ws.__playerId =
    crypto.randomUUID();

  ws.sessionId =
    crypto.randomUUID();

  ws.username =
    "Player" +
    Math.floor(
      Math.random() * 10000
    );

  ws.__mode = null;
  ws.__roomId = null;
  ws.__intentionalClose = false;

  safeSend(ws, {
    type: "connected",
    playerId:
      ws.__playerId
  });

  ws.on("message", raw => {
    let message;

    try {
      message =
        JSON.parse(
          raw.toString()
        );
    } catch {
      return;
    }

    const type =
      message.type;

    if (type === "set-username") {
      const oldUsername =
        ws.username;

      const username =
        String(
          message.username ||
          ""
        )
          .trim()
          .slice(0, 24);

      if (username) {
        ws.username =
          username;
      }

      if (message.sessionId) {
        ws.sessionId =
          String(
            message.sessionId
          );

        const existing =
          sessions.get(
            ws.sessionId
          );

        if (existing) {
          ws.__playerId =
            existing.playerId;

          ws.username =
            existing.username ||
            ws.username;

          const room =
            rooms.get(
              existing.roomId
            );

          if (room) {
            ws.__roomId =
              room.id;

            sendRoomState(
              room
            );
          }
        }
      }

      ensureProfile(
        ws.username
      );

      if (
        oldUsername !==
        ws.username
      ) {
        sendProfile(
          ws.username
        );
      }

      safeSend(ws, {
        type: "username-saved",
        username:
          ws.username
      });

      sendFriends(
        ws.username
      );

      broadcast({
        type: "online-count",
        count:
          clients.size
      });

      broadcastLeaderboards();

      return;
    }

    if (type === "get-profile") {
      sendProfile(
        ws.username
      );
      return;
    }

    if (type === "get-friends") {
      sendFriends(
        ws.username
      );
      return;
    }

    if (type === "friend-request") {
      const target =
        String(
          message.username ||
          ""
        )
          .trim()
          .slice(0, 24);

      if (
        !target ||
        target === ws.username
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "Invalid username."
        });
        return;
      }

      const targetExists =
        [...clients].some(
          c =>
            c.username ===
            target
        );

      if (!targetExists) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "That player is not online."
        });
        return;
      }

      if (
        ensureFriends(
          ws.username
        ).has(target)
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "You are already friends."
        });
        return;
      }

      ensureRequests(
        target
      ).add(
        ws.username
      );

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message:
          "Friend request sent!"
      });

      send(
        target,
        {
          type:
            "friend-request-received",
          username:
            ws.username
        }
      );

      sendFriends(target);

      return;
    }

    if (type === "friend-accept") {
      const requester =
        String(
          message.username ||
          ""
        )
          .trim()
          .slice(0, 24);

      if (
        !ensureRequests(
          ws.username
        ).has(requester)
      ) {
        safeSend(ws, {
          type: "friend-result",
          ok: false,
          message:
            "Friend request not found."
        });
        return;
      }

      addFriend(
        ws.username,
        requester
      );

      safeSend(ws, {
        type: "friend-result",
        ok: true,
        message:
          "Friend request accepted!"
      });

      return;
    }

    if (type === "find-match") {
      const mode =
        String(
          message.mode || ""
        );

      if (
        ![
          "face",
          "hunt",
          "chat",
          "pose",
          "laugh"
        ].includes(mode)
      ) {
        return;
      }

      findMatch(
        ws,
        mode
      );

      return;
    }

    if (type === "face-score") {
      handleFaceScore(
        ws,
        message
      );
      return;
    }

    if (type === "pose-score") {
      handlePoseScore(
        ws,
        message
      );
      return;
    }

    if (type === "hunt-found") {
      handleHuntFound(ws);
      return;
    }

    if (type === "laugh") {
      handleLaugh(ws);
      return;
    }

    if (type === "chat-message") {
      handleChatMessage(
        ws,
        message
      );
      return;
    }

    if (type === "skip") {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (room) {
        const opponent =
          otherPlayer(
            room,
            ws.__playerId
          );

        if (opponent) {
          const opponentWs =
            getClientByPlayerId(
              opponent.playerId
            );

          safeSend(
            opponentWs,
            {
              type:
                "opponent-skipped"
            }
          );
        }

        endRoom(room);
      }

      requeueAfterSkip(ws);

      return;
    }

    if (type === "leave") {
      ws.__intentionalClose =
        true;

      explicitLeave(ws);

      return;
    }

    if (type === "report") {
      const reason =
        String(
          message.reason ||
          "Other"
        )
          .slice(0, 200);

      reports.push({
        id:
          crypto.randomUUID(),
        from:
          ws.username,
        reason,
        createdAt:
          new Date().toISOString()
      });

      if (
        reports.length >
        MAX_REPORTS
      ) {
        reports.shift();
      }

      safeSend(ws, {
        type: "report-result",
        ok: true,
        message:
          "Report submitted."
      });

      return;
    }

    if (type === "dm-send") {
      const to =
        String(
          message.to || ""
        )
          .trim()
          .slice(0, 24);

      const text =
        String(
          message.text || ""
        )
          .slice(0, 500);

      if (!to || !text) return;

      const key =
        [ws.username, to]
          .sort()
          .join("|");

      if (
        !dmHistory.has(key)
      ) {
        dmHistory.set(
          key,
          []
        );
      }

      const history =
        dmHistory.get(key);

      history.push({
        from:
          ws.username,
        to,
        text,
        time:
          new Date().toISOString()
      });

      if (history.length > 100) {
        history.shift();
      }

      send(to, {
        type: "dm-message",
        from:
          ws.username,
        text
      });

      return;
    }

    if (type === "dm-history") {
      const other =
        String(
          message.username ||
          ""
        )
          .trim()
          .slice(0, 24);

      const key =
        [ws.username, other]
          .sort()
          .join("|");

      safeSend(ws, {
        type: "dm-history",
        username: other,
        messages:
          dmHistory.get(key) ||
          []
      });

      return;
    }

    if (type === "invite") {
      const target =
        String(
          message.username ||
          ""
        )
          .trim()
          .slice(0, 24);

      if (!target) return;

      const inviteId =
        crypto.randomUUID();

      pendingInvites.set(
        inviteId,
        {
          from:
            ws.username,
          to: target,
          mode:
            message.mode || "face",
          createdAt:
            Date.now()
        }
      );

      send(target, {
        type: "invite-received",
        inviteId,
        from:
          ws.username,
        mode:
          message.mode || "face"
      });

      return;
    }

    if (type === "invite-accept") {
      const invite =
        pendingInvites.get(
          message.inviteId
        );

      if (!invite) return;

      pendingInvites.delete(
        message.inviteId
      );

      const inviter =
        [...clients].find(
          c =>
            c.username ===
            invite.from
        );

      if (!inviter) return;

      removeFromWaiting(
        ws
      );

      removeFromWaiting(
        inviter
      );

      startMatch(
        inviter,
        ws,
        invite.mode
      );

      return;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);

    removeFromWaiting(ws);

    broadcast({
      type: "online-count",
      count:
        clients.size
    });

    /*
      IMPORTANT:

      If the connection disappears unexpectedly,
      DO NOT destroy the room.

      The player's session remains alive so they
      can reconnect and return to the same game.
    */

    if (
      !ws.__intentionalClose &&
      ws.__roomId
    ) {
      const room =
        rooms.get(
          ws.__roomId
        );

      if (room) {
        room.disconnected.add(
          ws.__playerId
        );

        const opponent =
          otherPlayer(
            room,
            ws.__playerId
          );

        if (opponent) {
          safeSend(
            getClientByPlayerId(
              opponent.playerId
            ),
            {
              type:
                "opponent-temporarily-disconnected"
            }
          );
        }
      }

      return;
    }

    if (
      ws.__intentionalClose
    ) {
      return;
    }

    if (ws.sessionId) {
      const session =
        sessions.get(
          ws.sessionId
        );

      if (!session) {
        return;
      }
    }
  });
});

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `EmojiTV server running on port ${PORT}`
    );
  }
);
