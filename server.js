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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    game: "EmojiTV"
  });
});

function send(ws, data) {
  if (
    ws &&
    ws.readyState === 1
  ) {
    ws.send(
      JSON.stringify(data)
    );
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
  const value = String(
    name || ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);

  return value || "Guest";
}

function removeFromWaiting(ws) {
  const i =
    waiting.indexOf(ws);

  if (i !== -1) {
    waiting.splice(i, 1);
  }
}

function randomItem(list) {
  return list[
    Math.floor(
      Math.random() *
      list.length
    )
  ];
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

function nextUnique(
  list,
  used
) {
  const available =
    list.filter(item => {
      const key =
        typeof item === "string"
          ? item
          : item.emoji;

      return !used.has(key);
    });

  const pick = randomItem(
    available.length
      ? available
      : list
  );

  const key =
    typeof pick === "string"
      ? pick
      : pick.emoji;

  used.add(key);

  return pick;
}

function nextHuntTarget(
  used
) {
  return {
    ...nextUnique(
      HUNT_ITEMS,
      used
    )
  };
}

function pairKey(a, b) {
  return [
    a,
    b
  ]
    .sort()
    .join("\u0000");
}

function ensureSet(
  map,
  key
) {
  if (!map.has(key)) {
    map.set(
      key,
      new Set()
    );
  }

  return map.get(key);
}

function isFriend(a, b) {
  return ensureSet(
    friends,
    a
  ).has(b);
}

function friendPayload(
  username
) {
  const list = [
    ...ensureSet(
      friends,
      username
    )
  ];

  const pending = [
    ...ensureSet(
      friendRequests,
      username
    )
  ];

  return {
    type: "friends",

    friends:
      list.map(name => ({
        username: name,

        online:
          [...clients].some(
            c =>
              c.username ===
              name
          )
      })),

    pending
  };
}

function sendFriends(
  username
) {
  for (const c of clients) {
    if (
      c.username ===
      username
    ) {
      send(
        c,
        friendPayload(
          username
        )
      );
    }
  }
}

function sendDmHistory(
  a,
  b
) {
  const history =
    dmHistory.get(
      pairKey(a, b)
    ) || [];

  for (const c of clients) {
    if (
      c.username === a
    ) {
      send(c, {
        type:
          "dm-history",
        with: b,
        messages:
          history.slice(
            -100
          )
      });
    }
  }
}

function addDm(
  a,
  b,
  text
) {
  const key =
    pairKey(a, b);

  const history =
    dmHistory.get(key) ||
    [];

  history.push({
    from: a,
    to: b,
    text,

    createdAt:
      new Date().toISOString()
  });

  if (
    history.length > 200
  ) {
    history.shift();
  }

  dmHistory.set(
    key,
    history
  );
}

function onlinePayload() {
  const names =
    [...clients]
      .map(
        ws =>
          ws.username ||
          "Guest"
      )
      .sort((a, b) =>
        a.localeCompare(b)
      );

  return {
    type:
      "online-list",

    count:
      clients.size,

    names
  };
}

function broadcastOnline() {
  broadcast(
    onlinePayload()
  );

  for (const c of clients) {
    sendFriends(
      c.username
    );
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
        todayKey() +
        "T00:00:00Z"
      ) / 86400000
    );

  return [
    0,
    1,
    2
  ].map(
    i =>
      DAILY_CHALLENGES[
        (day + i) %
        DAILY_CHALLENGES.length
      ]
  );
}

function ensureProfile(
  username
) {
  if (
    !profiles.has(username)
  ) {
    profiles.set(
      username,
      {
        username,
        xp: 0,
        level: 1,
        streak: 0,
        bestStreak: 0,
        gamesPlayed: 0,
        wins: 0,

        badges:
          new Set(),

        daily: {
          date:
            todayKey(),

          progress: {},

          completed: []
        }
      }
    );
  }

  const profile =
    profiles.get(
      username
    );

  if (
    profile.daily.date !==
    todayKey()
  ) {
    profile.daily = {
      date:
        todayKey(),

      progress: {},

      completed: []
    };
  }

  profile.level =
    Math.floor(
      profile.xp /
      XP_PER_LEVEL
    ) + 1;

  return profile;
}

function addXp(
  profile,
  amount
) {
  profile.xp += Math.max(
    0,
    Math.round(amount)
  );

  profile.level =
    Math.floor(
      profile.xp /
      XP_PER_LEVEL
    ) + 1;
}

function ensureStats(
  mode,
  username
) {
  if (
    !leaderboard[mode].has(
      username
    )
  ) {
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

  return leaderboard[
    mode
  ].get(username);
}

function dailyPayload(
  username
) {
  const profile =
    ensureProfile(
      username
    );

  const defs =
    challengeSetForToday();

  return {
    date:
      profile.daily.date,

    challenges:
      defs.map(
        challenge => ({
          ...challenge,

          progress:
            Math.min(
              challenge.target,
              Number(
                profile.daily
                  .progress[
                  challenge.id
                ] || 0
              )
            ),

          completed:
            profile.daily
              .completed
              .includes(
                challenge.id
              )
        })
      )
  };
}

function profilePayload(
  username
) {
  const p =
    ensureProfile(
      username
    );

  return {
    type: "profile",

    username:
      p.username,

    xp: p.xp,

    level:
      p.level,

    xpIntoLevel:
      p.xp %
      XP_PER_LEVEL,

    xpToNextLevel:
      XP_PER_LEVEL -
      (p.xp %
        XP_PER_LEVEL),

    streak:
      p.streak,

    bestStreak:
      p.bestStreak,

    gamesPlayed:
      p.gamesPlayed,

    wins:
      p.wins,

    badges:
      [...p.badges],

    daily:
      dailyPayload(
        username
      )
  };
}

function sendProfile(
  username
) {
  for (const c of clients) {
    if (
      c.username ===
      username
    ) {
      send(
        c,
        profilePayload(
          username
        )
      );
    }
  }
}

function badgeCheck(
  profile
) {
  const earned =
    new Set(
      profile.badges
    );

  if (
    profile.wins >= 1
  ) {
    earned.add(
      "first-win"
    );
  }

  if (
    profile.bestStreak >= 5
  ) {
    earned.add(
      "streak-5"
    );
  }

  if (
    profile.bestStreak >= 10
  ) {
    earned.add(
      "streak-10"
    );
  }

  if (
    profile.gamesPlayed >=
    100
  ) {
    earned.add(
      "games-100"
    );
  }

  const hunt =
    leaderboard.hunt.get(
      profile.username
    );

  if (
    hunt &&
    hunt.wins >= 1
  ) {
    earned.add(
      "hunt-master"
    );
  }

  if (
    ensureSet(
      friends,
      profile.username
    ).size >= 10
  ) {
    earned.add(
      "friends-10"
    );
  }

  profile.badges =
    earned;
}

function updateDaily(
  username,
  event,
  amount = 1
) {
  const p =
    ensureProfile(
      username
    );

  const defs =
    challengeSetForToday();

  for (const c of defs) {
    if (
      c.event !== event ||
      p.daily.completed.includes(
        c.id
      )
    ) {
      continue;
    }

    const current =
      Number(
        p.daily.progress[
          c.id
        ] || 0
      );

    const next =
      c.event === "streak"
        ? Math.max(
            current,
            amount
          )
        : current + amount;

    p.daily.progress[
      c.id
    ] = Math.min(
      c.target,
      next
    );

    if (
      p.daily.progress[
        c.id
      ] >= c.target
    ) {
      p.daily.completed.push(
        c.id
      );

      addXp(
        p,
        c.reward
      );

      send(
        [...clients].find(
          client =>
            client.username ===
            p.username
        ),
        {
          type:
            "daily-complete",

          challengeId:
            c.id,

          title:
            c.title,

          reward:
            c.reward
        }
      );
    }
  }
}

function updateProfileAndSend(
  username
) {
  const p =
    ensureProfile(
      username
    );

  badgeCheck(p);

  sendProfile(
    username
  );
}

function leaderboardPayload(
  mode
) {
  const rows =
    [
      ...leaderboard[
        mode
      ].values()
    ]
      .sort((a, b) => {
        if (
          b.wins !==
          a.wins
        ) {
          return (
            b.wins -
            a.wins
          );
        }

        if (
          b.points !==
          a.points
        ) {
          return (
            b.points -
            a.points
          );
        }

        return a.username.localeCompare(
          b.username
        );
      })
      .slice(0, 20)
      .map(
        (row, index) => ({
          rank:
            index + 1,

          username:
            row.username,

          wins:
            row.wins,

          points:
            row.points,

          games:
            row.games
        })
      );

  return {
    type:
      "leaderboard",

    mode,

    rows
  };
}

function xpLeaderboardPayload() {
  const rows =
    [...profiles.values()]
      .sort((a, b) => {
        if (
          b.xp !== a.xp
        ) {
          return (
            b.xp -
            a.xp
          );
        }

        if (
          b.level !==
          a.level
        ) {
          return (
            b.level -
            a.level
          );
        }

        if (
          b.wins !==
          a.wins
        ) {
          return (
            b.wins -
            a.wins
          );
        }

        return a.username.localeCompare(
          b.username
        );
      })
      .slice(0, 20)
      .map(
        (profile, index) => ({
          rank:
            index + 1,

          username:
            profile.username,

          xp:
            profile.xp,

          level:
            profile.level,

          streak:
            profile.streak
        })
      );

  return {
    type:
      "leaderboard",

    mode:
      "xp",

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
      leaderboardPayload(
        mode
      )
    );
  }

  broadcast(
    xpLeaderboardPayload()
  );
}

function awardGameXp(
  profile,
  mode,
  score,
  won
) {
  let xp = 50;

  if (won) {
    xp += 100;
  }

  if (
    mode === "face" ||
    mode === "pose"
  ) {
    xp += Math.round(
      score * 0.5
    );
  }

  if (
    mode === "hunt"
  ) {
    xp +=
      score * 10;
  }

  if (
    mode === "laugh"
  ) {
    xp +=
      score * 25;
  }

  addXp(
    profile,
    xp
  );
}

function applyGameResult(
  room
) {
  if (
    !room ||
    room.completed
  ) {
    return null;
  }

  room.completed =
    true;

  const players = [
    room.a,
    room.b
  ];

  const scores =
    room.scores;

  const aScore =
    scores[
      room.a.playerId
    ] || 0;

  const bScore =
    scores[
      room.b.playerId
    ] || 0;

  const winnerIds =
    aScore === bScore
      ? new Set()
      : new Set([
          aScore > bScore
            ? room.a.playerId
            : room.b.playerId
        ]);

  for (
    const player of players
  ) {
    const stats =
      ensureStats(
        room.mode,
        player.username
      );

    const playerScore =
      scores[
        player.playerId
      ] || 0;

    stats.games += 1;

    stats.points +=
      playerScore;

    const profile =
      ensureProfile(
        player.username
      );

    profile.gamesPlayed +=
      1;

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

      updateDaily(
        player.username,
        "win",
        1
      );

      updateDaily(
        player.username,
        "streak",
        profile.streak
      );
    } else if (
      room.mode !==
      "chat"
    ) {
      profile.streak = 0;
    }

    updateDaily(
      player.username,
      "game",
      1
    );

    if (
      room.mode ===
      "hunt"
    ) {
      updateDaily(
        player.username,
        "hunt",
        playerScore
      );
    }

    if (
      room.mode ===
      "face"
    ) {
      const bestRound =
        room.bestFaceRound?.[
          player.playerId
        ] || 0;

      if (
        bestRound >= 80
      ) {
        updateDaily(
          player.username,
          "score80",
          1
        );
      }
    }

    awardGameXp(
      profile,
      room.mode,
      playerScore,
      won
    );

    if (
      room.mode ===
        "face" &&
      room.perfectFace?.[
        player.playerId
      ] === true
    ) {
      profile.badges.add(
        "perfect-face"
      );
    }

    badgeCheck(
      profile
    );

    sendProfile(
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

function startMatch(
  a,
  b,
  mode
) {
  removeFromWaiting(a);
  removeFromWaiting(b);

  a.queueMode = null;
  b.queueMode = null;

  const roomId =
    createId();

  const room = {
    id:
      roomId,

    mode,

    a,

    b,

    round: 1,

    totalRounds:
      modeRounds(mode),

    scores: {
      [a.playerId]: 0,
      [b.playerId]: 0
    },

    roundScores: {},

    bestFaceRound: {
      [a.playerId]: 0,
      [b.playerId]: 0
    },

    perfectFace: {
      [a.playerId]: true,
      [b.playerId]: true
    },

    nextReady:
      new Set(),

    skipReady:
      new Set(),

    usedTargets:
      new Set(),

    target:
      mode === "hunt"
        ? nextHuntTarget(
            new Set()
          )
        : mode === "face"
          ? nextUnique(
              EMOJIS,
              new Set()
            )
          : mode === "pose"
            ? randomItem([
                "🕺",
                "🙆‍♂️",
                "🙋‍♂️",
                "💪",
                "🧍‍♂️",
                "🤸"
              ])
            : null,

    huntFound:
      false,

    huntStartedAt:
      null,

    huntTimer:
      null,

    laughScored:
      false,

    laughTimer:
      null,

    rematchReady:
      new Set(),

    completed:
      false
  };

  rooms.set(
    roomId,
    room
  );

  a.roomId =
    roomId;

  b.roomId =
    roomId;

  a.opponentUsername =
    b.username;

  b.opponentUsername =
    a.username;

  const base = {
    type:
      "match-started",

    roomId,

    mode,

    totalRounds:
      room.totalRounds,

    round: 1
  };

  send(a, {
    ...base,

    opponentUsername:
      b.username,

    target:
      room.target
  });

  send(b, {
    ...base,

    opponentUsername:
      a.username,

    target:
      room.target
  });

  if (
    mode === "hunt"
  ) {
    scheduleHuntTimeout(
      room
    );
  }

  if (
    mode === "laugh"
  ) {
    scheduleLaughTimeout(
      room
    );
  }
}

function putInQueue(
  ws,
  mode
) {
  removeFromWaiting(ws);

  ws.queueMode =
    mode;

  waiting.push(ws);

  send(ws, {
    type:
      "waiting",

    mode
  });
}

function findWaitingOpponent(
  mode
) {
  for (
    let i = 0;
    i < waiting.length;
    i++
  ) {
    const candidate =
      waiting[i];

    if (
      candidate &&
      candidate.readyState ===
        1 &&
      candidate.queueMode ===
        mode &&
      !candidate.roomId
    ) {
      waiting.splice(
        i,
        1
      );

      candidate.queueMode =
        null;

      return candidate;
    }
  }

  return null;
}

function clearHuntTimer(
  room
) {
  if (
    room?.huntTimer
  ) {
    clearTimeout(
      room.huntTimer
    );

    room.huntTimer =
      null;
  }
}

function clearLaughTimer(
  room
) {
  if (
    room?.laughTimer
  ) {
    clearTimeout(
      room.laughTimer
    );

    room.laughTimer =
      null;
  }
}

function scheduleHuntTimeout(
  room
) {
  clearHuntTimer(
    room
  );

  room.huntStartedAt =
    Date.now();

  room.huntTimer =
    setTimeout(
      () => {
        if (
          rooms.get(
            room.id
          ) !== room ||
          room.completed ||
          room.mode !==
            "hunt" ||
          room.huntFound
        ) {
          return;
        }

        room.huntFound =
          true;

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
      },
      HUNT_TIMEOUT_MS
    );
}

function scheduleLaughTimeout(
  room
) {
  clearLaughTimer(
    room
  );

  if (
    room.mode !==
    "laugh"
  ) {
    return;
  }

  room.laughScored =
    false;

  room.laughTimer =
    setTimeout(
      () => {
        if (
          rooms.get(
            room.id
          ) !== room ||
          room.completed ||
          room.mode !==
            "laugh" ||
          room.laughScored
        ) {
          return;
        }

        room.laughScored =
          true;

        send(
          room.a,
          {
            type:
              "laugh-timeout",

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
              "laugh-timeout",

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
          1400
        );
      },
      LAUGH_TIMEOUT_MS
    );
}

function sendNextRound(
  room
) {
  if (
    !room ||
    room.completed
  ) {
    return;
  }

  clearHuntTimer(
    room
  );

  clearLaughTimer(
    room
  );

  if (
    room.round >=
    room.totalRounds
  ) {
    const result =
      applyGameResult(
        room
      );

    send(
      room.a,
      {
        type:
          "game-complete",

        mode:
          room.mode,

        scores:
          room.scores,

        result
      }
    );

    send(
      room.b,
      {
        type:
          "game-complete",

        mode:
          room.mode,

        scores:
          room.scores,

        result
      }
    );

    return;
  }

  room.round += 1;

  room.roundScores =
    {};

  room.nextReady.clear();

  room.skipReady.clear();

  room.huntFound =
    false;

  room.laughScored =
    false;

  if (
    room.mode ===
    "hunt"
  ) {
    room.target =
      nextHuntTarget(
        room.usedTargets
      );
  }

  if (
    room.mode ===
    "face"
  ) {
    room.target =
      nextUnique(
        EMOJIS,
        room.usedTargets
      );
  }

  if (
    room.mode ===
    "pose"
  ) {
    room.target =
      randomItem([
        "🕺",
        "🙆‍♂️",
        "🙋‍♂️",
        "💪",
        "🧍‍♂️",
        "🤸"
      ]);
  }

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
        room.mode,

      target:
        room.target
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
        room.mode,

      target:
        room.target
    }
  );

  if (
    room.mode ===
    "hunt"
  ) {
    scheduleHuntTimeout(
      room
    );
  }

  if (
    room.mode ===
    "laugh"
  ) {
    scheduleLaughTimeout(
      room
    );
  }
}

function endRoom(
  ws,
  notifyOpponent = true
) {
  if (!ws.roomId) {
    return;
  }

  const room =
    rooms.get(
      ws.roomId
    );

  if (!room) {
    ws.roomId =
      null;

    return;
  }

  clearHuntTimer(
    room
  );

  clearLaughTimer(
    room
  );

  const opponent =
    room.a === ws
      ? room.b
      : room.a;

  rooms.delete(
    room.id
  );

  ws.roomId =
    null;

  ws.queueMode =
    null;

  if (opponent) {
    opponent.roomId =
      null;

    opponent.queueMode =
      null;

    if (
      notifyOpponent &&
      opponent.readyState ===
        1
    ) {
      send(
        opponent,
        {
          type:
            "opponent-disconnected",

          reason:
            "opponent-left",

          opponentUsername:
            ws.username
        }
      );
    }
  }
}

wss.on(
  "connection",
  ws => {
    ws.playerId =
      createId();

    ws.username =
      "Guest";

    ws.roomId =
      null;

    ws.queueMode =
      null;

    ws.opponentUsername =
      null;

    ws.isAlive =
      true;

    clients.add(ws);

    ensureProfile(
      ws.username
    );

    send(ws, {
      type:
        "connected",

      playerId:
        ws.playerId
    });

    send(
      ws,
      onlinePayload()
    );

    send(
      ws,
      profilePayload(
        ws.username
      )
    );

    ws.on(
      "pong",
      () => {
        ws.isAlive =
          true;
      }
    );

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

        if (
          message.type ===
          "set-username"
        ) {
          const oldName =
            ws.username;

          const newName =
            cleanName(
              message.username
            );

          ws.username =
            newName;

          ensureProfile(
            newName
          );

          send(
            ws,
            {
              type:
                "username-set",

              username:
                newName
            }
          );

          sendProfile(
            newName
          );

          broadcastOnline();

          if (
            oldName !==
            newName
          ) {
            sendFriends(
              oldName
            );
          }

          return;
        }

        if (
          message.type ===
          "get-profile"
        ) {
          sendProfile(
            ws.username
          );

          return;
        }

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

        if (
          message.type ===
          "friend-request"
        ) {
          const targetName =
            cleanName(
              message.username ||
              message.to
            );

          if (
            !targetName ||
            targetName ===
              ws.username
          ) {
            return;
          }

          const target =
            [...clients].find(
              c =>
                c.username ===
                targetName
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
              targetName
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
            targetName
          ).add(
            ws.username
          );

          send(
            target,
            {
              type:
                "friend-request",

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
                `Friend request sent to ${targetName}.`
            }
          );

          sendFriends(
            targetName
          );

          return;
        }

        if (
          message.type ===
          "friend-accept"
        ) {
          const from =
            cleanName(
              message.username ||
              message.from
            );

          const requests =
            ensureSet(
              friendRequests,
              ws.username
            );

          if (
            !requests.has(
              from
            )
          ) {
            return;
          }

          requests.delete(
            from
          );

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

          updateDaily(
            from,
            "friend",
            1
          );

          updateProfileAndSend(
            ws.username
          );

          updateProfileAndSend(
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

        if (
          message.type ===
          "friend-decline"
        ) {
          const from =
            cleanName(
              message.username ||
              message.from
            );

          ensureSet(
            friendRequests,
            ws.username
          ).delete(
            from
          );

          sendFriends(
            ws.username
          );

          return;
        }

        if (
          message.type ===
          "friend-remove"
        ) {
          const target =
            cleanName(
              message.username ||
              message.to
            );

          ensureSet(
            friends,
            ws.username
          ).delete(
            target
          );

          ensureSet(
            friends,
            target
          ).delete(
            ws.username
          );

          sendFriends(
            ws.username
          );

          sendFriends(
            target
          );

          updateProfileAndSend(
            ws.username
          );

          updateProfileAndSend(
            target
          );

          return;
        }

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
              .slice(
                0,
                300
              );

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
              type:
                "dm",

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
              .slice(
                0,
                1000
              );

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

          reports.push(
            report
          );

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

            ensureProfile(
              ws.username
            );
          }

          removeFromWaiting(
            ws
          );

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
          } else {
            putInQueue(
              ws,
              mode
            );
          }

          broadcastOnline();

          sendProfile(
            ws.username
          );

          return;
        }

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

        if (
          message.type ===
          "leave"
        ) {
          endRoom(
            ws,
            true
          );

          broadcastOnline();

          return;
        }

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
                room.rematchReady
                  .size
            }
          );

          send(
            room.b,
            {
              type:
                "rematch-status",

              ready:
                room.rematchReady
                  .size
            }
          );

          if (
            room.rematchReady
              .size === 2
          ) {
            room.rematchReady.clear();

            room.completed =
              false;

            room.round =
              1;

            room.scores = {
              [room.a.playerId]:
                0,

              [room.b.playerId]:
                0
            };

            room.roundScores =
              {};

            room.bestFaceRound =
              {};

            room.perfectFace = {
              [room.a.playerId]:
                true,

              [room.b.playerId]:
                true
            };

            room.nextReady =
              new Set();

            room.skipReady =
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

                round:
                  1,

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

                round:
                  1,

                totalRounds:
                  room.totalRounds,

                mode:
                  room.mode,

                target:
                  room.target
              }
            );

            if (
              room.mode ===
              "hunt"
            ) {
              scheduleHuntTimeout(
                room
              );
            }

            if (
              room.mode ===
              "laugh"
            ) {
              scheduleLaughTimeout(
                room
              );
            }
          }

          return;
        }

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
                room.skipReady
                  .size
            }
          );

          send(
            room.b,
            {
              type:
                "skip-item-status",

              ready:
                room.skipReady
                  .size
            }
          );

          if (
            room.skipReady
              .size === 2
          ) {
            room.skipReady.clear();

            room.huntFound =
              false;

            room.roundScores =
              {};

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
          }

          return;
        }

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
          ] = Math.max(
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
            (
              room.scores[
                ws.playerId
              ] || 0
            ) + score;

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
            (
              room.scores[
                ws.playerId
              ] || 0
            ) + score;

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

        if (
          message.type ===
            "laugh" &&
          room.mode ===
            "laugh" &&
          !room.laughScored
        ) {
          room.laughScored =
            true;

          clearLaughTimer(
            room
          );

          room.scores[
            ws.playerId
          ] =
            (
              room.scores[
                ws.playerId
              ] || 0
            ) + 1;

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

          clearHuntTimer(
            room
          );

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

          clearHuntTimer(
            room
          );

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
            room.nextReady
              .size === 2
          ) {
            sendNextRound(
              room
            );
          }

          return;
        }

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
            ).slice(
              0,
              300
            );

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

                self:
                  true
              }
            );
          }

          return;
        }

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

    ws.on(
      "close",
      () => {
        clients.delete(
          ws
        );

        removeFromWaiting(
          ws
        );

        endRoom(
          ws,
          true
        );

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
          sendFriends(
            name
          );
        }
      }
    );
  }
);

const PORT =
  process.env.PORT ||
  3000;

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `EmojiTV running on port ${PORT}`
    );
  }
);
