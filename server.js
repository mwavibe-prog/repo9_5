// Steady Sailors - Cooperative Boat Game Server
// Up to 15 players coordinate to row a boat to the finish line,
// steering around obstacles together. Designed to be simple and
// friendly for elderly players.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 15;

// Colors are high-contrast and easy to distinguish.
const PLAYER_COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA',
  '#00ACC1', '#6D4C41', '#D81B60', '#3949AB', '#7CB342',
  '#F4511E', '#00897B', '#C0CA33', '#5E35B2', '#FDD835'
];

// Core game state. One shared game - simplest for a family/community setting.
const game = {
  state: 'waiting', // 'waiting' | 'rowing' | 'steering' | 'won' | 'lost'
  players: new Map(), // socketId -> { id, name, color }
  boatPosition: 0,    // 0..100
  lives: 3,
  rowingVotes: new Set(),
  obstacle: null,     // { type, correctDirection, timeLeft, votes: Map }
  message: 'Waiting for sailors to join...',
  roundTimer: null,
};

app.use(express.static('public'));

// Pretty URL for the player phone page.
app.get('/play', (req, res) => {
  res.sendFile(__dirname + '/public/play.html');
});

// Return a QR code that points players at the /play page on the same host.
app.get('/qr', async (req, res) => {
  const host = req.headers.host;
  const url = `http://${host}/play`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', width: 320, margin: 1 });
    res.type('svg').send(svg);
  } catch (err) {
    res.status(500).send('QR error');
  }
});

// Small helper: send current state to everyone.
function broadcast() {
  const publicState = {
    state: game.state,
    boatPosition: game.boatPosition,
    lives: game.lives,
    message: game.message,
    playerCount: game.players.size,
    maxPlayers: MAX_PLAYERS,
    players: Array.from(game.players.values()),
    rowingProgress: game.rowingVotes.size,
    rowingNeeded: rowingThreshold(),
    obstacle: game.obstacle ? {
      type: game.obstacle.type,
      correctDirection: game.obstacle.correctDirection,
      timeLeft: game.obstacle.timeLeft,
      voteCounts: tallyVotes(game.obstacle.votes),
      voteNeeded: rowingThreshold(),
    } : null,
  };
  io.emit('state', publicState);
}

function rowingThreshold() {
  // Need at least half the players to act together. Minimum 1.
  return Math.max(1, Math.ceil(game.players.size / 2));
}

function tallyVotes(votesMap) {
  const counts = { left: 0, right: 0 };
  if (!votesMap) return counts;
  for (const dir of votesMap.values()) {
    if (counts[dir] !== undefined) counts[dir]++;
  }
  return counts;
}

function clearTimers() {
  if (game.roundTimer) {
    // clearTimeout and clearInterval both accept either handle type in Node.
    clearTimeout(game.roundTimer);
    clearInterval(game.roundTimer);
    game.roundTimer = null;
  }
}

function resetGame() {
  clearTimers();
  game.state = 'waiting';
  game.boatPosition = 0;
  game.lives = 3;
  game.rowingVotes.clear();
  game.obstacle = null;
  game.message = game.players.size > 0
    ? 'Press START when everyone is ready.'
    : 'Waiting for sailors to join...';
}

function startGame() {
  if (game.players.size === 0) return;
  clearTimers();
  game.boatPosition = 0;
  game.lives = 3;
  game.obstacle = null;
  game.rowingVotes.clear();
  beginRowingPhase();
}

function beginRowingPhase() {
  game.state = 'rowing';
  game.rowingVotes.clear();
  game.message = 'ROW TOGETHER! Tap the ROW button.';
  broadcast();
  clearTimers();
  // Safety net: if the group hasn't reached the rowing threshold in 15
  // seconds, send an obstacle anyway so play keeps moving. Generous window
  // so elderly players never feel rushed.
  game.roundTimer = setTimeout(() => {
    if (game.state === 'rowing' && game.boatPosition < 100) {
      beginSteeringPhase();
    }
  }, 15000);
}

function beginSteeringPhase() {
  clearTimers();
  const obstacleTypes = [
    { type: 'rock',      label: 'a big ROCK' },
    { type: 'whirlpool', label: 'a WHIRLPOOL' },
    { type: 'log',       label: 'a floating LOG' },
    { type: 'sandbar',   label: 'a SANDBAR' },
  ];
  const pick = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
  const correctDirection = Math.random() < 0.5 ? 'left' : 'right';

  game.obstacle = {
    type: pick.type,
    label: pick.label,
    correctDirection,
    timeLeft: 10, // 10 seconds - generous for elderly players
    votes: new Map(),
  };
  game.state = 'steering';
  game.message = `Watch out! ${pick.label} ahead. Steer ${correctDirection.toUpperCase()}!`;
  broadcast();

  // Countdown
  game.roundTimer = setInterval(() => {
    if (!game.obstacle) return;
    game.obstacle.timeLeft -= 1;
    if (game.obstacle.timeLeft <= 0) {
      resolveSteering();
    } else {
      broadcast();
    }
  }, 1000);
}

function resolveSteering() {
  clearTimers();
  const counts = tallyVotes(game.obstacle.votes);
  const needed = rowingThreshold();
  const correct = game.obstacle.correctDirection;
  const success = counts[correct] >= needed;

  if (success) {
    game.message = 'Great teamwork! You avoided the ' + game.obstacle.type + '.';
    io.emit('fx', { kind: 'cheer' });
  } else {
    game.lives -= 1;
    game.message = 'Oh no! The boat hit the ' + game.obstacle.type + '. Hold tight!';
    io.emit('fx', { kind: 'bump' });
  }
  game.obstacle = null;
  broadcast();

  if (game.lives <= 0) {
    game.state = 'lost';
    game.message = 'The boat has taken too much damage. Press RESTART to try again.';
    broadcast();
    return;
  }

  // Brief pause so players see the result, then continue rowing (or win).
  game.roundTimer = setTimeout(() => {
    if (game.boatPosition >= 100) {
      game.state = 'won';
      game.message = 'YOU MADE IT! Wonderful teamwork, everyone.';
      io.emit('fx', { kind: 'win' });
      broadcast();
    } else {
      beginRowingPhase();
    }
  }, 2500);
}

function handleRow(socketId) {
  if (game.state !== 'rowing') return;
  if (!game.players.has(socketId)) return;
  if (game.rowingVotes.has(socketId)) return; // Already rowed this stroke

  game.rowingVotes.add(socketId);
  const needed = rowingThreshold();

  if (game.rowingVotes.size >= needed) {
    // Everyone (or enough of us) rowed together -> boat advances.
    game.boatPosition = Math.min(100, game.boatPosition + 15);
    game.rowingVotes.clear();
    io.emit('fx', { kind: 'stroke' });
    broadcast();

    if (game.boatPosition >= 100) {
      clearTimers();
      game.state = 'won';
      game.message = 'YOU MADE IT! Wonderful teamwork, everyone.';
      io.emit('fx', { kind: 'win' });
      broadcast();
      return;
    }

    // After a successful row, move on to steering challenge quickly.
    clearTimers();
    game.roundTimer = setTimeout(() => {
      if (game.state === 'rowing') beginSteeringPhase();
    }, 1500);
  } else {
    broadcast();
  }
}

function handleSteer(socketId, direction) {
  if (game.state !== 'steering' || !game.obstacle) return;
  if (!game.players.has(socketId)) return;
  if (direction !== 'left' && direction !== 'right') return;
  game.obstacle.votes.set(socketId, direction);
  const counts = tallyVotes(game.obstacle.votes);
  const needed = rowingThreshold();
  // If enough players already voted correctly, resolve early so elderly players
  // aren't left waiting around.
  if (counts[game.obstacle.correctDirection] >= needed) {
    resolveSteering();
  } else {
    broadcast();
  }
}

io.on('connection', (socket) => {
  socket.on('joinHost', () => {
    socket.join('host');
    socket.emit('hostReady');
    broadcast();
  });

  socket.on('joinPlayer', (rawName) => {
    if (game.players.size >= MAX_PLAYERS) {
      socket.emit('joinError', 'The boat is full! (15 sailors max)');
      return;
    }
    const name = (typeof rawName === 'string' ? rawName.trim() : '').slice(0, 20)
      || `Sailor ${game.players.size + 1}`;
    const color = PLAYER_COLORS[game.players.size % PLAYER_COLORS.length];
    const player = { id: socket.id, name, color };
    game.players.set(socket.id, player);
    socket.emit('joined', player);
    if (game.state === 'waiting' && game.players.size === 1) {
      game.message = 'Press START when everyone is ready.';
    }
    broadcast();
  });

  socket.on('start', () => {
    if (game.state === 'waiting' || game.state === 'won' || game.state === 'lost') {
      startGame();
    }
  });

  socket.on('reset', () => {
    resetGame();
    broadcast();
  });

  socket.on('row', () => handleRow(socket.id));
  socket.on('steer', (dir) => handleSteer(socket.id, dir));

  socket.on('disconnect', () => {
    if (game.players.delete(socket.id)) {
      // Remove their pending votes too.
      game.rowingVotes.delete(socket.id);
      if (game.obstacle) game.obstacle.votes.delete(socket.id);
      if (game.players.size === 0) {
        resetGame();
      }
      broadcast();
    }
  });
});

function getLocalIps() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, () => {
  const ips = getLocalIps();
  console.log('=============================================');
  console.log(' Steady Sailors - Cooperative Boat Game');
  console.log('=============================================');
  console.log(` Host screen:   http://localhost:${PORT}/`);
  console.log(` Player phones: http://localhost:${PORT}/play`);
  if (ips.length) {
    console.log('\n On the same Wi-Fi, players can also use:');
    for (const ip of ips) console.log(`   http://${ip}:${PORT}/play`);
  }
  console.log('=============================================');
});
