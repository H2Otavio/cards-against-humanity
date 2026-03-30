// ============================================
// CARDS AGAINST HUMANITY - CLIENT
// Mobile-First Optimized
// ============================================

const socket = io();

// ---- DOM refs ----
const screens = {
  home: document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game')
};

// Home
const nicknameInput = document.getElementById('nickname-input');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');

// Lobby
const lobbyRoomCode = document.getElementById('lobby-room-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const btnStartGame = document.getElementById('btn-start-game');
const lobbyWaitingMsg = document.getElementById('lobby-waiting-msg');
const lobbyHint = document.getElementById('lobby-hint');
const btnLeaveRoomLobby = document.getElementById('btn-leave-room-lobby');

// Game
const gameRound = document.getElementById('game-round');
const gameGoal = document.getElementById('game-goal');
const btnScoreboardToggle = document.getElementById('btn-scoreboard-toggle');
const btnLeaveRoomGame = document.getElementById('btn-leave-room-game');
const scoreboardPanel = document.getElementById('scoreboard-panel');
const btnCloseScoreboard = document.getElementById('btn-close-scoreboard');
const scoreboardList = document.getElementById('scoreboard-list');
const blackCard = document.getElementById('black-card');
const blackCardText = document.getElementById('black-card-text');
const czarBadge = document.getElementById('czar-badge');
const gameStatus = document.getElementById('game-status');
const submissionsArea = document.getElementById('submissions-area');
const submissionsGrid = document.getElementById('submissions-grid');
const handArea = document.getElementById('hand-area');
const handCards = document.getElementById('hand-cards');
const handScrollHint = document.getElementById('hand-scroll-hint');

// Overlays
const roundEndOverlay = document.getElementById('round-end-overlay');
const winnerName = document.getElementById('winner-name');
const miniBlackCard = document.getElementById('mini-black-card');
const miniWhiteCard = document.getElementById('mini-white-card');
const btnNextRound = document.getElementById('btn-next-round');
const gameOverOverlay = document.getElementById('game-over-overlay');
const gameOverWinner = document.getElementById('game-over-winner');
const finalScoreboard = document.getElementById('final-scoreboard');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnBackLobby = document.getElementById('btn-back-lobby');

// Toast
const toastContainer = document.getElementById('toast-container');

// Lucky Easter Egg
const btnFeelingLucky = document.getElementById('btn-feeling-lucky');
const luckyModal = document.getElementById('lucky-modal');
const luckyBlackText = document.getElementById('lucky-black-text');
const luckyWhiteText = document.getElementById('lucky-white-text');
const btnLuckyAgain = document.getElementById('btn-lucky-again');
const btnLuckyClose = document.getElementById('btn-lucky-close');

// ---- State ----
let currentState = null;
let selectedCardIndex = null;
let myName = '';
let hasScrolledHand = false;

// ============================================
// MOBILE VIEWPORT FIX
// On iOS, 100vh doesn't account for address bar.
// We use CSS 100dvh but also set a JS fallback.
// ============================================
function setVH() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
setVH();
window.addEventListener('resize', setVH);
window.addEventListener('orientationchange', () => {
  setTimeout(setVH, 100);
});

// Prevent overscroll/bounce on iOS
document.body.addEventListener('touchmove', (e) => {
  // Allow scrolling inside scrollable containers
  let target = e.target;
  while (target && target !== document.body) {
    const style = window.getComputedStyle(target);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
        style.overflowX === 'auto' || style.overflowX === 'scroll') {
      return; // Allow scroll
    }
    target = target.parentElement;
  }
  e.preventDefault();
}, { passive: false });

// ---- Particles (reduced count on mobile for performance) ----
(function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  const isMobile = window.innerWidth < 600;
  const PARTICLE_COUNT = isMobile ? 20 : 40;
  const CONNECTION_DIST = isMobile ? 120 : 150;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3;
      this.size = Math.random() * 2 + 0.5;
      this.alpha = Math.random() * 0.3 + 0.05;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
      if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(124, 58, 237, ${this.alpha})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    // Draw connections (skip on very small screens for perf)
    if (!isMobile || PARTICLE_COUNT <= 20) {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(124, 58, 237, ${0.05 * (1 - dist / CONNECTION_DIST)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }
    requestAnimationFrame(animate);
  }
  animate();
})();

// ---- Screen Management ----
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  
  // Close scoreboard when switching screens
  scoreboardPanel.classList.add('hidden');
}

// ---- Toast ----
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---- Vibrate helper (for mobile haptic feedback) ----
function vibrate(ms = 15) {
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

// ---- Home Events ----
btnCreateRoom.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if (!name) {
    showToast('Digite seu apelido!', 'error');
    vibrate(30);
    nicknameInput.focus();
    return;
  }
  myName = name;
  nicknameInput.blur(); // Close mobile keyboard
  socket.emit('createRoom', { playerName: name });
});

btnJoinRoom.addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name) {
    showToast('Digite seu apelido!', 'error');
    vibrate(30);
    nicknameInput.focus();
    return;
  }
  if (!code) {
    showToast('Digite o código da sala!', 'error');
    vibrate(30);
    roomCodeInput.focus();
    return;
  }
  myName = name;
  nicknameInput.blur(); // Close mobile keyboard
  roomCodeInput.blur();
  socket.emit('joinRoom', { roomCode: code, playerName: name });
});

btnFeelingLucky.addEventListener('click', () => {
  vibrate(10);
  socket.emit('luckyDraw');
});

btnLuckyAgain.addEventListener('click', () => {
  vibrate(10);
  socket.emit('luckyDraw');
});

btnLuckyClose.addEventListener('click', () => {
  vibrate(10);
  luckyModal.classList.add('hidden');
});

// Leave Room Logic
function leaveRoom() {
  localStorage.removeItem('cah-session');
  socket.emit('leaveRoom');
  
  // Reset local state UI
  currentState = null;
  myName = '';
  playerList.innerHTML = '';
  scoreboardList.innerHTML = '';
  gameStatus.innerHTML = '';
  handCards.innerHTML = '';
  submissionsGrid.innerHTML = '';
  
  showScreen('home');
  vibrate(15);
}

btnLeaveRoomLobby.addEventListener('click', leaveRoom);
btnLeaveRoomGame.addEventListener('click', () => {
  if (confirm('Tem certeza que deseja sair da partida atual?')) {
    leaveRoom();
  }
});

// Enter key on inputs
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (roomCodeInput.value.trim()) {
      btnJoinRoom.click();
    } else {
      btnCreateRoom.click();
    }
  }
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnJoinRoom.click();
  }
});

// Copy room code
btnCopyCode.addEventListener('click', () => {
  const code = lobbyRoomCode.textContent;
  vibrate(10);
  navigator.clipboard.writeText(code).then(() => {
    showToast('Código copiado! 📋', 'success');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = code;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Código copiado! 📋', 'success');
  });
});

// Lobby buttons
btnStartGame.addEventListener('click', () => {
  vibrate(20);
  socket.emit('startGame');
});

// Scoreboard toggle
btnScoreboardToggle.addEventListener('click', () => {
  vibrate(10);
  scoreboardPanel.classList.toggle('hidden');
});
btnCloseScoreboard.addEventListener('click', () => {
  scoreboardPanel.classList.add('hidden');
});

// Close scoreboard when tapping elsewhere on mobile
document.addEventListener('click', (e) => {
  if (!scoreboardPanel.classList.contains('hidden') &&
      !scoreboardPanel.contains(e.target) &&
      !btnScoreboardToggle.contains(e.target)) {
    scoreboardPanel.classList.add('hidden');
  }
});

// Next round
btnNextRound.addEventListener('click', () => {
  vibrate(20);
  roundEndOverlay.classList.add('hidden');
  socket.emit('nextRound');
});

// Play again / back to lobby
btnPlayAgain.addEventListener('click', () => {
  vibrate(20);
  gameOverOverlay.classList.add('hidden');
  socket.emit('playAgain');
});
btnBackLobby.addEventListener('click', () => {
  vibrate(20);
  gameOverOverlay.classList.add('hidden');
  socket.emit('backToLobby');
});

// ============================================
// SOCKET EVENTS
// ============================================
socket.on('roomCreated', ({ roomCode }) => {
  showToast(`Sala ${roomCode} criada!`, 'success');
});

socket.on('playerJoined', ({ playerName }) => {
  vibrate(15);
  showToast(`${playerName} entrou na sala!`, 'info');
});

socket.on('playerLeft', ({ playerName }) => {
  showToast(`${playerName} saiu da sala`, 'info');
});

socket.on('error', ({ message }) => {
  if (message.includes('Sala não encontrada')) {
    localStorage.removeItem('cah-session');
  }
  vibrate(40);
  showToast(message, 'error');
});

socket.on('gameState', (state) => {
  if (myName && state.code) {
    localStorage.setItem('cah-session', JSON.stringify({ name: myName, code: state.code }));
  }
  const prevState = currentState;
  currentState = state;
  renderState(state, prevState);
});

socket.on('luckyResult', ({ blackCard, whiteCard }) => {
  let blackText = blackCard;
  if (blackText.includes('_')) {
    blackText = blackText.replace(/_+/g, `<span class="blank"></span>`);
  }
  luckyBlackText.innerHTML = blackText;
  luckyWhiteText.textContent = whiteCard;
  luckyModal.classList.remove('hidden');
});

socket.on('connect', () => {
  // Reconnect if session exists
  const savedSession = localStorage.getItem('cah-session');
  if (savedSession) {
    try {
      const { name, code } = JSON.parse(savedSession);
      if (name && code) {
        myName = name;
        socket.emit('joinRoom', { roomCode: code, playerName: name });
      }
    } catch(e) {}
  }
});

// ============================================
// RENDER STATE
// ============================================
function renderState(state, prevState) {
  if (state.state === 'lobby') {
    showScreen('lobby');
    renderLobby(state);
  } else {
    showScreen('game');
    renderGame(state, prevState);
  }
}

// ---- Lobby Rendering ----
function renderLobby(state) {
  lobbyRoomCode.textContent = state.code;
  playerCount.textContent = `(${state.players.length})`;

  playerList.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = p.name.charAt(0).toUpperCase();
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = p.name;

    li.appendChild(avatar);
    li.appendChild(nameSpan);

    if (i === 0) {
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'HOST';
      li.appendChild(badge);
    }

    playerList.appendChild(li);
  });

  if (state.isHost) {
    btnStartGame.style.display = '';
    lobbyWaitingMsg.style.display = 'none';
    if (state.players.length < state.minPlayers) {
      btnStartGame.disabled = true;
      btnStartGame.style.opacity = '0.5';
      lobbyHint.textContent = `Mínimo ${state.minPlayers} jogadores para começar`;
    } else {
      btnStartGame.disabled = false;
      btnStartGame.style.opacity = '1';
      lobbyHint.textContent = '✅ Tudo pronto! Inicie quando todos estiverem aqui.';
    }
  } else {
    btnStartGame.style.display = 'none';
    lobbyWaitingMsg.style.display = '';
    lobbyHint.textContent = `Compartilhe o código ${state.code} com seus amigos!`;
  }
}

// ---- Game Rendering ----
function renderGame(state, prevState) {
  // Top bar
  gameRound.textContent = `Rodada ${state.roundNumber}`;
  gameGoal.textContent = `Meta: ${state.pointsToWin} pts`;

  // Scoreboard
  renderScoreboard(state);

  // Black card
  if (state.currentBlackCard) {
    const formattedText = state.currentBlackCard.replace(
      /_____/g,
      '<span style="border-bottom: 3px solid #7c3aed; padding: 0 16px;">&nbsp;&nbsp;&nbsp;&nbsp;</span>'
    );
    blackCardText.innerHTML = formattedText;
  }

  // Czar badge
  if (state.isCzar) {
    czarBadge.innerHTML = '👑 <strong>Você é o Juiz!</strong> Aguarde as respostas.';
  } else {
    czarBadge.innerHTML = `⚖️ Juiz: <strong>${state.czarName}</strong>`;
  }

  // Handle game states
  if (state.state === 'playing') {
    renderPlayingState(state);
  } else if (state.state === 'judging') {
    renderJudgingState(state, prevState);
  } else if (state.state === 'roundEnd') {
    renderRoundEnd(state);
  } else if (state.state === 'gameOver') {
    renderGameOver(state);
  }
}

function renderPlayingState(state) {
  submissionsArea.classList.add('hidden');
  roundEndOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');

  // Count submissions
  const submitted = state.players.filter(p => p.hasSubmitted && !p.isCzar).length;
  const total = state.players.filter(p => p.connected && !p.isCzar).length;

  if (state.isCzar) {
    gameStatus.innerHTML = `Aguardando respostas... <span class="highlight">${submitted}/${total}</span>`;
    handArea.style.display = 'none';
  } else {
    const me = state.players.find(p => p.name === myName);
    if (me && me.hasSubmitted) {
      gameStatus.innerHTML = `Carta enviada! ✅ Aguardando... <span class="highlight">${submitted}/${total}</span>`;
      handArea.style.display = 'none';
    } else {
      gameStatus.innerHTML = '👇 Escolha uma carta!';
      handArea.style.display = '';
      renderHand(state);
    }
  }
}

function renderJudgingState(state, prevState) {
  handArea.style.display = 'none';
  roundEndOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  submissionsArea.classList.remove('hidden');

  if (state.isCzar) {
    gameStatus.innerHTML = '👑 <span class="highlight">Toque na melhor resposta!</span>';
    vibrate(25);
  } else {
    gameStatus.innerHTML = '⏳ O Juiz está escolhendo...';
  }

  renderSubmissions(state);
}

function renderRoundEnd(state) {
  submissionsArea.classList.add('hidden');
  handArea.style.display = 'none';
  gameOverOverlay.classList.add('hidden');
  roundEndOverlay.classList.remove('hidden');

  if (state.roundWinner) {
    winnerName.textContent = state.roundWinner.playerName;
    miniBlackCard.textContent = state.currentBlackCard;
    miniWhiteCard.textContent = state.roundWinner.card;
    vibrate([20, 60, 20]); // Pattern vibration
  }

  // Only host can advance
  btnNextRound.style.display = state.isHost ? '' : 'none';
  gameStatus.innerHTML = '';
}

function renderGameOver(state) {
  submissionsArea.classList.add('hidden');
  handArea.style.display = 'none';
  roundEndOverlay.classList.add('hidden');
  gameOverOverlay.classList.remove('hidden');

  if (state.roundWinner) {
    gameOverWinner.textContent = state.roundWinner.playerName;
  }

  // Final scoreboard
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  finalScoreboard.innerHTML = sorted.map((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `<div class="final-score-row">
      <span class="rank">${medal}</span>
      <span class="name">${p.name}</span>
      <span class="pts">${p.score} pts</span>
    </div>`;
  }).join('');

  // Confetti + vibrate
  spawnConfetti();
  vibrate([50, 100, 50, 100, 50]);

  btnPlayAgain.style.display = state.isHost ? '' : 'none';
  btnBackLobby.style.display = state.isHost ? '' : 'none';
  gameStatus.innerHTML = '';
}

// ---- Render Hand ----
function renderHand(state) {
  handCards.innerHTML = '';
  
  // Remove any existing submit container
  const existingSubmitContainer = handArea.querySelector('.submit-btn-container');
  if (existingSubmitContainer) existingSubmitContainer.remove();

  // Show scroll hint if more than 3 cards visible
  if (!hasScrolledHand && state.hand.length > 3) {
    handScrollHint.classList.remove('hidden');
  }

  state.hand.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'hand-card';
    
    const textSpan = document.createElement('span');
    textSpan.textContent = card;
    cardEl.appendChild(textSpan);
    
    const footer = document.createElement('span');
    footer.className = 'card-footer';
    footer.textContent = 'Cards Against Humanity';
    cardEl.appendChild(footer);

    cardEl.addEventListener('click', (e) => {
      e.stopPropagation();
      vibrate(10);
      
      if (selectedCardIndex === index) {
        // Deselect
        selectedCardIndex = null;
        document.querySelectorAll('.hand-card').forEach(c => c.classList.remove('selected'));
        const submitC = handArea.querySelector('.submit-btn-container');
        if (submitC) submitC.classList.remove('visible');
      } else {
        // Select
        selectedCardIndex = index;
        document.querySelectorAll('.hand-card').forEach(c => c.classList.remove('selected'));
        cardEl.classList.add('selected');
        
        // Scroll the selected card into center view
        cardEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        
        let submitContainer = handArea.querySelector('.submit-btn-container');
        if (!submitContainer) {
          submitContainer = document.createElement('div');
          submitContainer.className = 'submit-btn-container';
          const submitBtn = document.createElement('button');
          submitBtn.className = 'btn-submit-card';
          submitBtn.textContent = 'Enviar Carta ✉️';
          submitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedCardIndex !== null) {
              vibrate(20);
              socket.emit('submitCard', { cardIndex: selectedCardIndex });
              selectedCardIndex = null;
              submitContainer.classList.remove('visible');
            }
          });
          submitContainer.appendChild(submitBtn);
          handArea.insertBefore(submitContainer, handCards);
        }
        submitContainer.classList.add('visible');
      }
    });

    handCards.appendChild(cardEl);
  });

  selectedCardIndex = null;

  // Track scroll to hide hint
  handCards.addEventListener('scroll', () => {
    if (!hasScrolledHand) {
      hasScrolledHand = true;
      handScrollHint.classList.add('hidden');
    }
  }, { once: true });
}

// ---- Render Submissions ----
function renderSubmissions(state) {
  submissionsGrid.innerHTML = '';

  state.submissions.forEach((sub, index) => {
    const card = document.createElement('div');

    if (sub.hidden) {
      card.className = 'submission-card hidden-card';
      card.textContent = '?';
    } else {
      card.className = 'submission-card';
      card.textContent = sub.card;
      card.style.animationDelay = `${index * 0.12}s`;

      const footer = document.createElement('span');
      footer.className = 'card-footer';
      footer.textContent = 'Cards Against Humanity';
      card.appendChild(footer);

      if (state.isCzar) {
        card.classList.add('selectable');
        card.addEventListener('click', () => {
          vibrate(20);
          document.querySelectorAll('.submission-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          
          // Confirm selection after a brief moment
          setTimeout(() => {
            socket.emit('selectWinner', { submissionIndex: index });
          }, 500);
        });
      }
    }

    submissionsGrid.appendChild(card);
  });
}

// ---- Render Scoreboard ----
function renderScoreboard(state) {
  scoreboardList.innerHTML = '';
  
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const li = document.createElement('li');
    if (!p.connected) li.classList.add('disconnected');

    const nameArea = document.createElement('span');
    nameArea.className = 'score-name';

    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p.connected ? 'var(--accent-green)' : 'var(--text-muted)'}`;
    nameArea.appendChild(dot);

    const name = document.createElement('span');
    name.textContent = p.name;
    nameArea.appendChild(name);

    if (p.isCzar) {
      const badge = document.createElement('span');
      badge.className = 'czar-indicator';
      badge.textContent = '👑 JUIZ';
      nameArea.appendChild(badge);
    }

    const score = document.createElement('span');
    score.className = 'score-value';
    score.textContent = p.score;

    li.appendChild(nameArea);
    li.appendChild(score);
    scoreboardList.appendChild(li);
  });
}

// ---- Confetti ----
function spawnConfetti() {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';
  const colors = ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];
  
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.top = '-10px';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 8 + 4) + 'px';
    piece.style.height = (Math.random() * 8 + 4) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDelay = Math.random() * 1.5 + 's';
    piece.style.animationDuration = (Math.random() * 1 + 1.5) + 's';
    container.appendChild(piece);
  }
}

// ---- Init ----
window.addEventListener('load', () => {
  const savedSession = localStorage.getItem('cah-session');
  if (savedSession) {
    try {
      const { name, code } = JSON.parse(savedSession);
      if (name) nicknameInput.value = name;
      if (code) roomCodeInput.value = code;
    } catch(e) {}
  }

  // Don't auto-focus on mobile (prevents keyboard from popping up)
  if (window.innerWidth > 600) {
    nicknameInput.focus();
  }

  // Force socket reconnection when mobile browser tab becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket.connected) {
      socket.connect();
    }
  });
});
