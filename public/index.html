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
const leaderboard = { face: new Map(), hunt: new Map(), chat: new Map() };
const reports = [];
const MAX_REPORTS = 5000;

const friends = new Map();
const friendRequests = new Map();
const dmHistory = new Map();
const pendingInvites = new Map();

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
  { emoji:"🧻", label:"toilet paper", aliases:["toilet paper","a roll of toilet paper"] },
  { emoji:"🍎", label:"apple", aliases:["an apple","a red apple","apple"] },
  { emoji:"🍌", label:"banana", aliases:["a banana","banana"] },
  { emoji:"🥤", label:"cup", aliases:["a cup","a drinking cup","plastic cup"] },
  { emoji:"🧴", label:"bottle", aliases:["a bottle","a plastic bottle","water bottle"] },
  { emoji:"📕", label:"book", aliases:["a book","a red book"] },
  { emoji:"🥄", label:"spoon", aliases:["a spoon","a metal spoon"] },
  { emoji:"🧸", label:"teddy bear", aliases:["a teddy bear","a stuffed bear","stuffed animal"] },
  { emoji:"📱", label:"cell phone", aliases:["a cell phone","a smartphone","a phone"] },
  { emoji:"🪥", label:"toothbrush", aliases:["a toothbrush","toothbrush"] },
  { emoji:"🎧", label:"headphones", aliases:["headphones","a pair of headphones"] },
  { emoji:"🕶️", label:"sunglasses", aliases:["sunglasses","a pair of sunglasses"] },
  { emoji:"⚽", label:"soccer ball", aliases:["a soccer ball","soccer ball"] },
  { emoji:"🏀", label:"basketball", aliases:["a basketball","basketball"] },
  { emoji:"🎮", label:"game controller", aliases:["a game controller","controller"] },
  { emoji:"⌚", label:"watch", aliases:["a watch","smartwatch"] },
  { emoji:"✏️", label:"pencil", aliases:["a pencil","pencil"] },
  { emoji:"🖊️", label:"pen", aliases:["a pen","pen"] },
  { emoji:"🧢", label:"cap", aliases:["a cap","a baseball cap","hat"] },
  { emoji:"👟", label:"shoe", aliases:["a shoe","sneaker"] }
];

const TOTAL_FACE_ROUNDS = 5;
const TOTAL_HUNT_ROUNDS = 10;

app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(_,res)=>res.json({ok:true,game:"EmojiTV"}));

function send(ws,data){
  if(ws && ws.readyState===1) ws.send(JSON.stringify(data));
}

function broadcast(data){
  for(const ws of clients) send(ws,data);
}

function createId(){
  return crypto.randomUUID();
}

function cleanName(name){
  const value=String(name||"").trim().replace(/\s+/g," ").slice(0,20);
  return value||"Guest";
}

function removeFromWaiting(ws){
  const i=waiting.indexOf(ws);
  if(i!==-1) waiting.splice(i,1);
}

function randomItem(list){
  return list[Math.floor(Math.random()*list.length)];
}

function modeRounds(mode){
  return mode==="hunt" ? TOTAL_HUNT_ROUNDS : TOTAL_FACE_ROUNDS;
}

function nextUnique(list,used){
  const available=list.filter(x=>!used.has(typeof x==="string"?x:x.emoji));
  const pick=randomItem(available.length?available:list);
  used.add(typeof pick==="string"?pick:pick.emoji);
  return pick;
}

function nextHuntTarget(used){
  return {...nextUnique(HUNT_ITEMS,used)};
}

function ensureSet(map,key){
  if(!map.has(key)) map.set(key,new Set());
  return map.get(key);
}

function isFriend(a,b){
  return ensureSet(friends,a).has(b);
}

function friendPayload(username){
  const list=[...ensureSet(friends,username)];
  const pending=[...ensureSet(friendRequests,username)];

  return {
    type:"friends",
    friends:list.map(name=>({
      username:name,
      online:[...clients].some(c=>c.username===name)
    })),
    pending
  };
}

function sendFriends(username){
  for(const c of clients){
    if(c.username===username){
      send(c,friendPayload(username));
    }
  }
}

function sendDmHistory(a,b){
  const history=dmHistory.get([a,b].sort().join("\u0000"))||[];

  for(const c of clients){
    if(c.username===a){
      send(c,{
        type:"dm-history",
        with:b,
        messages:history.slice(-100)
      });
    }
  }
}

function addDm(a,b,text){
  const key=[a,b].sort().join("\u0000");
  const history=dmHistory.get(key)||[];

  history.push({
    from:a,
    to:b,
    text,
    createdAt:new Date().toISOString()
  });

  if(history.length>200) history.shift();

  dmHistory.set(key,history);
}

function onlinePayload(){
  const names=[...clients]
    .map(ws=>ws.username||"Guest")
    .sort((a,b)=>a.localeCompare(b));

  return {
    type:"online-list",
    count:clients.size,
    names
  };
}

function broadcastOnline(){
  broadcast(onlinePayload());

  for(const c of clients){
    sendFriends(c.username);
  }
}

function ensureStats(mode,username){
  if(!leaderboard[mode].has(username)){
    leaderboard[mode].set(username,{
      username,
      wins:0,
      points:0,
      games:0
    });
  }

  return leaderboard[mode].get(username);
}

function recordCompletedGame(room){
  if(!room||room.completed) return;

  room.completed=true;

  const players=[room.a,room.b];
  const scores=room.scores;

  const aScore=scores[room.a.playerId]||0;
  const bScore=scores[room.b.playerId]||0;

  for(const player of players){
    const stats=ensureStats(room.mode,player.username);

    stats.games+=1;
    stats.points+=scores[player.playerId]||0;
  }

  if(aScore>bScore){
    ensureStats(room.mode,room.a.username).wins+=1;
  }

  if(bScore>aScore){
    ensureStats(room.mode,room.b.username).wins+=1;
  }

  broadcastLeaderboards();
}

function leaderboardPayload(mode){
  const rows=[...leaderboard[mode].values()]
    .sort(
      (a,b)=>
        b.wins-a.wins ||
        b.points-a.points ||
        a.username.localeCompare(b.username)
    )
    .slice(0,20)
    .map((x,i)=>({
      rank:i+1,
      ...x
    }));

  return {
    mode,
    rows
  };
}

function broadcastLeaderboards(){
  for(const mode of ["face","hunt","chat"]){
    broadcast(leaderboardPayload(mode));
  }
}

function endRoom(ws,notifyOpponent=true){
  removeFromWaiting(ws);

  if(!ws.roomId) return null;

  const roomId=ws.roomId;
  const room=rooms.get(roomId);

  if(!room){
    ws.roomId=null;
    return null;
  }

  const opponent=room.a===ws ? room.b : room.a;

  if(room.mode==="chat"&&!room.completed){
    room.completed=true;

    ensureStats("chat",room.a.username).games+=1;
    ensureStats("chat",room.b.username).games+=1;

    ensureStats("chat",room.a.username).points+=1;
    ensureStats("chat",room.b.username).points+=1;

    broadcastLeaderboards();
  }

  if(opponent&&notifyOpponent){
    send(opponent,{type:"opponent-left"});
  }

  if(room.a) room.a.roomId=null;
  if(room.b) room.b.roomId=null;

  rooms.delete(roomId);

  return opponent;
}

function putInQueue(ws,mode){
  removeFromWaiting(ws);

  if(ws.readyState!==1) return;

  ws.queueMode=mode;
  waiting.push(ws);

  send(ws,{
    type:"waiting",
    mode
  });
}

function findWaitingOpponent(mode){
  for(let i=0;i<waiting.length;i++){
    const candidate=waiting[i];

    if(
      candidate.readyState===1 &&
      candidate.queueMode===mode
    ){
      waiting.splice(i,1);
      candidate.queueMode=null;
      return candidate;
    }
  }

  return null;
}

function startMatch(playerA,playerB,mode){
  const roomId=createId();

  const usedTargets=new Set();

  const target=
    mode==="hunt"
      ? nextHuntTarget(usedTargets)
      : mode==="face"
        ? nextUnique(EMOJIS,usedTargets)
        : null;

  const rounds=modeRounds(mode);

  const room={
    id:roomId,
    a:playerA,
    b:playerB,
    mode,
    round:1,
    totalRounds:rounds,
    target,
    usedTargets,
    scores:{
      [playerA.playerId]:0,
      [playerB.playerId]:0
    },
    roundScores:{},
    nextReady:new Set(),
    rematchReady:new Set(),
    skipReady:new Set(),
    huntFound:false,
    completed:false
  };

  rooms.set(roomId,room);

  playerA.roomId=roomId;
  playerB.roomId=roomId;

  playerA.role="a";
  playerB.role="b";

  const base={
    type:"matched",
    roomId,
    round:1,
    totalRounds:rounds,
    mode,
    target
  };

  send(playerA,{
    ...base,
    role:"a",
    opponentId:playerB.playerId,
    opponentUsername:playerB.username
  });

  send(playerB,{
    ...base,
    role:"b",
    opponentId:playerA.playerId,
    opponentUsername:playerA.username
  });
}

function sendNextRound(room){
  if(room.round>=room.totalRounds){
    recordCompletedGame(room);

    send(room.a,{
      type:"game-over",
      mode:room.mode,
      finalScores:room.scores
    });

    send(room.b,{
      type:"game-over",
      mode:room.mode,
      finalScores:room.scores
    });

    return;
  }

  room.round+=1;
  room.nextReady.clear();
  room.skipReady.clear();
  room.huntFound=false;
  room.roundScores={};

  room.target=
    room.mode==="hunt"
      ? nextHuntTarget(room.usedTargets)
      : room.mode==="face"
        ? nextUnique(EMOJIS,room.usedTargets)
        : null;

  const message={
    type:"new-round",
    round:room.round,
    totalRounds:room.totalRounds,
    mode:room.mode,
    target:room.target
  };

  send(room.a,message);
  send(room.b,message);
}

wss.on("connection",ws=>{
  clients.add(ws);

  ws.playerId=createId();
  ws.roomId=null;
  ws.role=null;
  ws.queueMode=null;
  ws.username="Guest";

  send(ws,{
    type:"ready",
    playerId:ws.playerId,
    username:ws.username
  });

  send(ws,onlinePayload());
  broadcastOnline();

  ws.on("message",raw=>{
    let message;

    try{
      message=JSON.parse(raw.toString());
    }catch{
      return;
    }

    if(message.type==="set-username"){
      const oldName=ws.username;

      ws.username=cleanName(message.username);

      send(ws,{
        type:"username-saved",
        username:ws.username
      });

      if(oldName!==ws.username){
        broadcastOnline();
        sendFriends(oldName);
        sendFriends(ws.username);
      }

      return;
    }

    if(message.type==="get-friends"){
      send(ws,friendPayload(ws.username));
      return;
    }

    if(message.type==="friend-request"){
      const to=cleanName(message.to);

      if(!to||to===ws.username) return;

      const target=[...clients].find(
        c=>c.username===to
      );

      if(!target){
        send(ws,{
          type:"friend-result",
          ok:false,
          error:"That player is not online."
        });
        return;
      }

      if(isFriend(ws.username,to)){
        send(ws,{
          type:"friend-result",
          ok:false,
          error:"You are already friends."
        });
        return;
      }

      ensureSet(friendRequests,to).add(ws.username);

      send(target,{
        type:"friend-request-received",
        from:ws.username
      });

      send(ws,{
        type:"friend-result",
        ok:true,
        message:`Friend request sent to ${to}.`
      });

      sendFriends(to);
      sendFriends(ws.username);

      return;
    }

    if(message.type==="friend-accept"){
      const from=cleanName(message.from);

      ensureSet(friendRequests,ws.username).delete(from);

      ensureSet(friends,ws.username).add(from);
      ensureSet(friends,from).add(ws.username);

      send(ws,{
        type:"friend-result",
        ok:true,
        message:`You are now friends with ${from}.`
      });

      sendFriends(ws.username);
      sendFriends(from);

      return;
    }

    if(message.type==="friend-invite"){
      const to=cleanName(message.to);

      const mode=
        ["face","chat","hunt"].includes(message.mode)
          ? message.mode
          : "face";

      if(!to||to===ws.username) return;

      if(!isFriend(ws.username,to)){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"You can only invite friends."
        });
        return;
      }

      const target=[...clients].find(
        c=>c.username===to
      );

      if(!target){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"That friend is offline."
        });
        return;
      }

      if(ws.roomId||ws.queueMode){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"Leave your current match before sending an invite."
        });
        return;
      }

      if(target.roomId||target.queueMode){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"That friend is already busy."
        });
        return;
      }

      const inviteId=createId();

      pendingInvites.set(inviteId,{
        from:ws.username,
        to,
        mode,
        createdAt:Date.now()
      });

      send(target,{
        type:"game-invite",
        inviteId,
        from:ws.username,
        mode
      });

      send(ws,{
        type:"invite-result",
        ok:true,
        message:`Invite sent to ${to}.`
      });

      return;
    }

    if(message.type==="decline-invite"){
      const id=String(message.inviteId||"");
      const invite=pendingInvites.get(id);

      if(!invite||invite.to!==ws.username) return;

      pendingInvites.delete(id);

      const sender=[...clients].find(
        c=>c.username===invite.from
      );

      if(sender){
        send(sender,{
          type:"invite-declined",
          from:ws.username
        });
      }

      return;
    }

    if(message.type==="accept-invite"){
      const id=String(message.inviteId||"");
      const invite=pendingInvites.get(id);

      if(!invite||invite.to!==ws.username){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"That invite is no longer available."
        });
        return;
      }

      if(ws.roomId||ws.queueMode){
        send(ws,{
          type:"invite-result",
          ok:false,
          error:"You are already in a game."
        });
        return;
      }

      const sender=[...clients].find(
        c=>c.username===invite.from
      );

      if(!sender||sender.roomId||sender.queueMode){
        pendingInvites.delete(id);

        send(ws,{
          type:"invite-result",
          ok:false,
          error:"Your friend is no longer available."
        });

        return;
      }

      pendingInvites.delete(id);

      startMatch(sender,ws,invite.mode);
      broadcastOnline();

      return;
    }

    if(message.type==="dm"){
      const to=cleanName(message.to);
      const text=String(message.text||"")
        .trim()
        .slice(0,300);

      if(!text||!isFriend(ws.username,to)) return;

      addDm(ws.username,to,text);

      for(const c of clients){
        if(c.username===to){
          send(c,{
            type:"dm",
            from:ws.username,
            text,
            createdAt:new Date().toISOString()
          });
        }
      }

      send(ws,{
        type:"dm",
        from:ws.username,
        text,
        createdAt:new Date().toISOString()
      });

      sendDmHistory(ws.username,to);
      sendDmHistory(to,ws.username);

      return;
    }

    if(message.type==="get-dm-history"){
      const to=cleanName(message.to);

      if(isFriend(ws.username,to)){
        sendDmHistory(ws.username,to);
      }

      return;
    }

    if(message.type==="get-leaderboards"){
      for(const mode of ["face","hunt","chat"]){
        send(ws,leaderboardPayload(mode));
      }

      return;
    }

    if(message.type==="report"){
      const allowedModes=[
        "face",
        "chat",
        "hunt"
      ];

      const reasons=[
        "harassment",
        "sexual-content",
        "hate",
        "threats",
        "spam",
        "privacy",
        "other"
      ];

      const room=ws.roomId
        ? rooms.get(ws.roomId)
        : null;

      const mode=
        allowedModes.includes(message.mode)
          ? message.mode
          : room?.mode;

      if(!mode||!room){
        send(ws,{
          type:"report-result",
          ok:false,
          error:"You can only report someone while connected to a game."
        });

        return;
      }

      const opponent=
        room.a===ws
          ? room.b
          : room.a;

      if(!opponent) return;

      const reason=
        reasons.includes(message.reason)
          ? message.reason
          : "other";

      const details=
        String(message.details||"")
          .trim()
          .slice(0,1000);

      const report={
        id:createId(),
        createdAt:new Date().toISOString(),
        mode,
        reporterId:ws.playerId,
        reporterUsername:ws.username,
        reportedId:opponent.playerId,
        reportedUsername:opponent.username,
        roomId:room.id,
        reason,
        details
      };

      reports.push(report);

      if(reports.length>MAX_REPORTS){
        reports.shift();
      }

      console.log(
        "EmojiTV REPORT",
        JSON.stringify(report)
      );

      send(ws,{
        type:"report-result",
        ok:true,
        reportId:report.id
      });

      return;
    }

    if(message.type==="find-match"){
      const mode=
        ["face","chat","hunt"].includes(message.mode)
          ? message.mode
          : "face";

      if(message.username){
        ws.username=cleanName(message.username);
      }

      removeFromWaiting(ws);

      const opponent=findWaitingOpponent(mode);

      if(opponent){
        startMatch(opponent,ws,mode);
      }else{
        putInQueue(ws,mode);
      }

      broadcastOnline();

      return;
    }

    if(message.type==="skip"){
      const oldMode=
        ws.roomId
          ? rooms.get(ws.roomId)?.mode
          : ws.queueMode;

      endRoom(ws,true);

      if(oldMode){
        putInQueue(ws,oldMode);
      }

      broadcastOnline();

      return;
    }

    if(message.type==="leave"){
      endRoom(ws,true);
      broadcastOnline();
      return;
    }

    if(!ws.roomId) return;

    const room=rooms.get(ws.roomId);

    if(!room) return;

    const opponent=
      room.a===ws
        ? room.b
        : room.a;

    if(message.type==="rematch-ready"){
      room.rematchReady.add(ws.playerId);

      send(room.a,{
        type:"rematch-status",
        ready:room.rematchReady.size
      });

      send(room.b,{
        type:"rematch-status",
        ready:room.rematchReady.size
      });

      if(room.rematchReady.size===2){
        room.rematchReady.clear();
        room.completed=false;
        room.round=1;

        room.scores={
          [room.a.playerId]:0,
          [room.b.playerId]:0
        };

        room.roundScores={};
        room.nextReady=new Set();
        room.skipReady=new Set();
        room.huntFound=false;
        room.usedTargets=new Set();

        room.target=
          room.mode==="hunt"
            ? nextHuntTarget(room.usedTargets)
            : room.mode==="face"
              ? nextUnique(EMOJIS,room.usedTargets)
              : null;

        send(room.a,{
          type:"rematch-started",
          round:1,
          totalRounds:room.totalRounds,
          mode:room.mode,
          target:room.target
        });

        send(room.b,{
          type:"rematch-started",
          round:1,
          totalRounds:room.totalRounds,
          mode:room.mode,
          target:room.target
        });
      }

      return;
    }

    if(message.type==="skip-item"&&room.mode==="hunt"){
      if(room.target?.emoji!=="🧻"){
        send(ws,{
          type:"skip-item-result",
          ok:false,
          error:"Skip Item is only available for the toilet paper item."
        });

        return;
      }

      room.skipReady.add(ws.playerId);

      send(room.a,{
        type:"skip-item-status",
        ready:room.skipReady.size
      });

      send(room.b,{
        type:"skip-item-status",
        ready:room.skipReady.size
      });

      if(room.skipReady.size===2){
        room.skipReady.clear();
        room.huntFound=false;
        room.roundScores={};

        room.target=nextHuntTarget(room.usedTargets);

        const msg={
          type:"new-round",
          round:room.round,
          totalRounds:room.totalRounds,
          mode:"hunt",
          target:room.target,
          skipped:true
        };

        send(room.a,msg);
        send(room.b,msg);
      }

      return;
    }

    if(message.type==="round-score"&&room.mode==="face"){
      const score=Math.max(
        0,
        Math.min(
          100,
          Number(message.score)||0
        )
      );

      room.roundScores[ws.playerId]=score;

      room.scores[ws.playerId]=
        (room.scores[ws.playerId]||0)+score;

      send(ws,{
        type:"your-score",
        score,
        totalScore:room.scores[ws.playerId],
        round:room.round
      });

      send(opponent,{
        type:"opponent-score",
        score,
        totalScore:room.scores[ws.playerId],
        round:room.round
      });

      return;
    }

    if(
      message.type==="hunt-found" &&
      room.mode==="hunt" &&
      !room.huntFound
    ){
      room.huntFound=true;

      room.scores[ws.playerId]+=1;

      send(room.a,{
        type:"hunt-winner",
        winnerId:ws.playerId,
        round:room.round,
        scores:room.scores
      });

      send(room.b,{
        type:"hunt-winner",
        winnerId:ws.playerId,
        round:room.round,
        scores:room.scores
      });

      setTimeout(()=>{
        if(rooms.get(room.id)===room){
          sendNextRound(room);
        }
      },2200);

      return;
    }

    if(message.type==="next-round"&&room.mode==="face"){
      room.nextReady.add(ws.playerId);

      if(room.nextReady.size===2){
        sendNextRound(room);
      }

      return;
    }

    if(message.type==="chat-message"&&room.mode==="chat"){
      const text=String(message.text||"").slice(0,300);

      if(text){
        send(opponent,{
          type:"chat-message",
          text
        });

        send(ws,{
          type:"chat-message",
          text,
          self:true
        });
      }

      return;
    }

    if(message.type==="signal"&&opponent){
      send(opponent,{
        type:"signal",
        signal:message.signal,
        from:ws.playerId
      });
    }
  });

  ws.on("close",()=>{
    clients.delete(ws);
    removeFromWaiting(ws);
    endRoom(ws,true);

    for(const [id,invite] of pendingInvites){
      if(
        invite.from===ws.username ||
        invite.to===ws.username
      ){
        pendingInvites.delete(id);
      }
    }

    broadcastOnline();

    for(const name of ensureSet(friends,ws.username)){
      sendFriends(name);
    }
  });
});

const PORT=process.env.PORT||3000;

server.listen(PORT,"0.0.0.0",()=>{
  console.log(`EmojiTV running on port ${PORT}`);
});
