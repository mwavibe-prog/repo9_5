// Host screen logic - shows the big game view on a TV / projector / shared screen.
// Players join on their phones via the QR code.

const socket = io();

const els = {
  qr:            document.getElementById('qr'),
  joinUrl:       document.getElementById('joinUrl'),
  playerCount:   document.getElementById('playerCount'),
  playerList:    document.getElementById('playerList'),
  statusBanner:  document.getElementById('statusBanner'),
  lives:         document.getElementById('lives'),
  boat:          document.getElementById('boat'),
  obstacle:      document.getElementById('obstacle'),
  progressFill:  document.getElementById('progressFill'),
  progressPct:   document.getElementById('progressPct'),
  phasePanel:    document.getElementById('phasePanel'),
  startBtn:      document.getElementById('startBtn'),
  resetBtn:      document.getElementById('resetBtn'),
};

// Build the join URL + QR.
const joinUrl = `${location.origin}/play`;
els.joinUrl.textContent = joinUrl;

fetch('/qr')
  .then(r => r.text())
  .then(svg => { els.qr.innerHTML = svg; })
  .catch(() => { els.qr.textContent = `Go to ${joinUrl}`; });

socket.emit('joinHost');

els.startBtn.addEventListener('click', () => socket.emit('start'));
els.resetBtn.addEventListener('click', () => socket.emit('reset'));

// --- Audio cues (short, gentle beeps). Kept simple with Web Audio. ---
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { /* ignore - audio is optional */ }
  }
  return audioCtx;
}
// Unlock audio on first user interaction (browsers require this).
document.addEventListener('click', () => ensureAudio(), { once: true });

function beep(freq, duration = 0.15, type = 'sine', vol = 0.2) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = vol;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

socket.on('fx', ({ kind }) => {
  if (kind === 'stroke') beep(520, 0.12, 'sine', 0.2);
  else if (kind === 'cheer') { beep(660, 0.15); setTimeout(() => beep(880, 0.2), 120); }
  else if (kind === 'bump')  { beep(180, 0.25, 'sawtooth', 0.25); }
  else if (kind === 'win')   {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2), i * 150));
  }
});

// Render the big game state.
socket.on('state', (s) => {
  // Player roster
  els.playerCount.textContent = s.playerCount;
  els.playerList.innerHTML = '';
  for (const p of s.players) {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.style.background = p.color;
    els.playerList.appendChild(li);
  }

  // Status banner
  els.statusBanner.textContent = s.message;
  els.statusBanner.classList.remove('ok','bad');
  if (s.state === 'won') els.statusBanner.classList.add('ok');
  if (s.state === 'lost') els.statusBanner.classList.add('bad');

  // Lives
  const lifeSpans = els.lives.querySelectorAll('.life');
  lifeSpans.forEach((el, i) => {
    el.classList.toggle('lost', i >= s.lives);
  });

  // Boat position (leave 10% of right edge for the finish flags)
  const pct = Math.max(0, Math.min(100, s.boatPosition));
  els.boat.style.left = `calc(${pct * 0.82}% + 10px)`;
  els.progressFill.style.width = pct + '%';
  els.progressPct.textContent = Math.round(pct);

  // Obstacle
  if (s.obstacle) {
    els.obstacle.classList.remove('hidden');
    els.obstacle.textContent = obstacleEmoji(s.obstacle.type);
  } else {
    els.obstacle.classList.add('hidden');
    els.obstacle.textContent = '';
  }

  // Phase panel
  renderPhasePanel(s);

  // Start button only enabled in waiting/won/lost
  const canStart = (s.state === 'waiting' || s.state === 'won' || s.state === 'lost') && s.playerCount > 0;
  els.startBtn.disabled = !canStart;
  els.startBtn.textContent = (s.state === 'won' || s.state === 'lost') ? 'PLAY AGAIN' : 'START';
});

function obstacleEmoji(type) {
  switch (type) {
    case 'rock':      return '\uD83E\uDEA8'; // rock
    case 'whirlpool': return '\uD83C\uDF00'; // cyclone
    case 'log':       return '\uD83E\uDEB5'; // wood
    case 'sandbar':   return '\uD83C\uDFDD\uFE0F'; // beach
    default:          return '\u26A0\uFE0F';
  }
}

function renderPhasePanel(s) {
  const p = els.phasePanel;
  p.innerHTML = '';
  if (s.state === 'waiting') {
    p.innerHTML = '<p class="help-line">Scan the QR code on the left to join. Up to 15 sailors.</p>';
    return;
  }
  if (s.state === 'rowing') {
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:800;">\uD83D\uDEA3 ROW TOGETHER!</div>
      <div class="row-progress">
        <strong>${s.rowingProgress}</strong> of <strong>${s.rowingNeeded}</strong> sailors have rowed
      </div>
      <p class="help-line">Everyone on their phone: tap the big green ROW button.</p>`;
    return;
  }
  if (s.state === 'steering' && s.obstacle) {
    const dir = s.obstacle.correctDirection;
    const arrow = dir === 'left' ? '\u2B05\uFE0F' : '\u27A1\uFE0F';
    const count = s.obstacle.voteCounts[dir];
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:800;">STEER ${dir.toUpperCase()}!</div>
      <div class="arrow">${arrow}</div>
      <div class="countdown">${s.obstacle.timeLeft}s</div>
      <div class="row-progress">
        <strong>${count}</strong> of <strong>${s.obstacle.voteNeeded}</strong> sailors steering ${dir}
      </div>`;
    return;
  }
  if (s.state === 'won') {
    p.innerHTML = `
      <div style="font-size:3rem;font-weight:900;color:#2e7d32;">\uD83C\uDF89 YOU WON! \uD83C\uDF89</div>
      <p class="help-line">The boat safely reached the shore. Press PLAY AGAIN for another trip.</p>`;
    return;
  }
  if (s.state === 'lost') {
    p.innerHTML = `
      <div style="font-size:2rem;font-weight:900;color:#c62828;">The boat sank... \uD83D\uDEA4</div>
      <p class="help-line">Don't worry - press PLAY AGAIN to try once more.</p>`;
  }
}
