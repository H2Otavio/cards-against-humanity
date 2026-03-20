const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { blackCards, whiteCards } = require('./cards');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static('public'));

// ============================================
// GAME STATE
// ============================================
const rooms = new Map();

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function createRoom(hostId, hostName) {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room = {
    code: roomCode,
    hostId: hostId,
    players: [{
      id: hostId,
      name: hostName,
      score: 0,
      hand: [],
      submittedCard: null,
      connected: true
    }],
    state: 'lobby', // lobby, playing, judging, roundEnd, gameOver
    blackDeck: [],
    whiteDeck: [],
    currentBlackCard: null,
    czarIndex: 0,
    submissions: [],
    roundWinner: null,
    pointsToWin: 7,
    minPlayers: 3,
    maxPlayers: 10,
    roundNumber: 0
  };
  rooms.set(roomCode, room);
  return room;
}

function initDecks(room) {
  room.blackDeck = shuffleArray(blackCards);
  room.whiteDeck = shuffleArray(whiteCards);
}

function dealCards(room, count = 7) {
  for (const player of room.players) {
    while (player.hand.length < count) {
      if (room.whiteDeck.length === 0) {
        room.whiteDeck = shuffleArray(whiteCards);
      }
      player.hand.push(room.whiteDeck.pop());
    }
  }
}

function startRound(room) {
  room.state = 'playing';
  room.submissions = [];
  room.roundWinner = null;
  room.roundNumber++;

  // Reset submitted cards
  for (const player of room.players) {
    player.submittedCard = null;
  }

  // Draw black card
  if (room.blackDeck.length === 0) {
    room.blackDeck = shuffleArray(blackCards);
  }
  room.currentBlackCard = room.blackDeck.pop();

  // Deal up to 7 cards
  dealCards(room, 7);
}

function getActivePlayers(room) {
  return room.players.filter(p => p.connected);
}

function getNonCzarPlayers(room) {
  return getActivePlayers(room).filter((_, i) => {
    const playerIndex = room.players.indexOf(getActivePlayers(room)[i]);
    return playerIndex !== room.czarIndex;
  });
}

function getCzar(room) {
  return room.players[room.czarIndex];
}

function advanceCzar(room) {
  const active = getActivePlayers(room);
  if (active.length === 0) return;
  
  let nextIndex = (room.czarIndex + 1) % room.players.length;
  // Find next connected player
  let attempts = 0;
  while (!room.players[nextIndex].connected && attempts < room.players.length) {
    nextIndex = (nextIndex + 1) % room.players.length;
    attempts++;
  }
  room.czarIndex = nextIndex;
}

function getRoomState(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  const czar = getCzar(room);
  const isCzar = czar && czar.id === playerId;

  return {
    code: room.code,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      hasSubmitted: p.submittedCard !== null,
      isCzar: getCzar(room) && getCzar(room).id === p.id
    })),
    hand: player ? player.hand : [],
    currentBlackCard: room.currentBlackCard,
    isCzar: isCzar,
    czarName: czar ? czar.name : '',
    submissions: room.state === 'judging' || room.state === 'roundEnd'
      ? room.submissions
      : room.submissions.map(() => ({ card: '???', hidden: true })),
    roundWinner: room.roundWinner,
    isHost: room.hostId === playerId,
    pointsToWin: room.pointsToWin,
    roundNumber: room.roundNumber,
    minPlayers: room.minPlayers
  };
}

// ============================================
// SOCKET.IO EVENTS
// ============================================
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('createRoom', ({ playerName }) => {
    playerId = socket.id;
    const room = createRoom(playerId, playerName);
    currentRoom = room.code;
    socket.join(room.code);
    socket.emit('roomCreated', { roomCode: room.code });
    socket.emit('gameState', getRoomState(room, playerId));
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', { message: 'Sala não encontrada!' });
      return;
    }

    const existingPlayer = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());

    if (room.state !== 'lobby' && !existingPlayer) {
      socket.emit('error', { message: 'O jogo já começou!' });
      return;
    }

    if (existingPlayer) {
      if (existingPlayer.connected) {
        socket.emit('error', { message: 'Já existe um jogador ativo com esse nome!' });
        return;
      }
      
      // Reconnect disconnected player
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
      playerId = socket.id;
      currentRoom = code;
      socket.join(code);
      
      io.to(code).emit('playerJoined', { playerName: `${playerName} (reconectou)` });
      broadcastState(room);
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: 'Sala cheia!' });
      return;
    }

    playerId = socket.id;
    room.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      hand: [],
      submittedCard: null,
      connected: true
    });

    currentRoom = code;
    socket.join(code);
    
    // Notify all players
    io.to(code).emit('playerJoined', { playerName });
    broadcastState(room);
  });

  socket.on('startGame', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    if (room.hostId !== playerId) {
      socket.emit('error', { message: 'Apenas o host pode iniciar o jogo!' });
      return;
    }

    const activePlayers = getActivePlayers(room);
    if (activePlayers.length < room.minPlayers) {
      socket.emit('error', { message: `Mínimo de ${room.minPlayers} jogadores para começar!` });
      return;
    }

    initDecks(room);
    room.czarIndex = 0;
    startRound(room);
    broadcastState(room);
  });

  socket.on('submitCard', ({ cardIndex }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'playing') return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const czar = getCzar(room);
    if (czar && czar.id === playerId) {
      socket.emit('error', { message: 'O Juiz não pode submeter carta!' });
      return;
    }

    if (player.submittedCard !== null) {
      socket.emit('error', { message: 'Você já submeteu uma carta!' });
      return;
    }

    if (cardIndex < 0 || cardIndex >= player.hand.length) return;

    const card = player.hand.splice(cardIndex, 1)[0];
    player.submittedCard = card;
    room.submissions.push({
      playerId: player.id,
      playerName: player.name,
      card: card
    });

    broadcastState(room);

    // Check if all non-czar players have submitted
    const activePlayers = getActivePlayers(room);
    const nonCzar = activePlayers.filter(p => {
      return getCzar(room) && p.id !== getCzar(room).id;
    });
    const allSubmitted = nonCzar.every(p => p.submittedCard !== null);

    if (allSubmitted) {
      room.state = 'judging';
      // Shuffle submissions so czar can't guess who submitted what
      room.submissions = shuffleArray(room.submissions);
      broadcastState(room);
    }
  });

  socket.on('selectWinner', ({ submissionIndex }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'judging') return;

    const czar = getCzar(room);
    if (!czar || czar.id !== playerId) {
      socket.emit('error', { message: 'Apenas o Juiz pode escolher o vencedor!' });
      return;
    }

    if (submissionIndex < 0 || submissionIndex >= room.submissions.length) return;

    const winner = room.submissions[submissionIndex];
    const winnerPlayer = room.players.find(p => p.id === winner.playerId);
    if (winnerPlayer) {
      winnerPlayer.score++;
    }

    room.roundWinner = {
      playerName: winner.playerName,
      card: winner.card,
      selectedIndex: submissionIndex
    };
    room.state = 'roundEnd';

    // Check if someone won the game
    if (winnerPlayer && winnerPlayer.score >= room.pointsToWin) {
      room.state = 'gameOver';
      room.roundWinner.gameWinner = true;
    }

    broadcastState(room);
  });

  socket.on('nextRound', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'roundEnd') return;
    if (room.hostId !== playerId) return;

    advanceCzar(room);
    startRound(room);
    broadcastState(room);
  });

  socket.on('playAgain', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'gameOver') return;
    if (room.hostId !== playerId) return;

    // Reset everything
    for (const player of room.players) {
      player.score = 0;
      player.hand = [];
      player.submittedCard = null;
    }
    room.roundNumber = 0;
    room.czarIndex = 0;
    
    initDecks(room);
    startRound(room);
    broadcastState(room);
  });

  socket.on('backToLobby', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.hostId !== playerId) return;

    // Reset to lobby
    for (const player of room.players) {
      player.score = 0;
      player.hand = [];
      player.submittedCard = null;
    }
    room.state = 'lobby';
    room.roundNumber = 0;
    room.currentBlackCard = null;
    room.submissions = [];
    room.roundWinner = null;

    broadcastState(room);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.connected = false;
      io.to(currentRoom).emit('playerLeft', { playerName: player.name });
    }

    // If in lobby and player disconnects, remove them
    if (room.state === 'lobby') {
      room.players = room.players.filter(p => p.id !== playerId);
      
      // If host left, transfer or close
      if (room.hostId === playerId) {
        if (room.players.length > 0) {
          room.hostId = room.players[0].id;
        } else {
          rooms.delete(currentRoom);
          return;
        }
      }
    }

    // Clean up empty rooms
    const activePlayers = getActivePlayers(room);
    if (activePlayers.length === 0) {
      rooms.delete(currentRoom);
      return;
    }

    // If during game and czar disconnects, advance and restart round
    if (room.state === 'playing' || room.state === 'judging') {
      const czar = getCzar(room);
      if (czar && czar.id === playerId) {
        advanceCzar(room);
        if (getActivePlayers(room).length >= room.minPlayers) {
          startRound(room);
        } else {
          room.state = 'lobby';
        }
      }
    }

    broadcastState(room);
  });

  function broadcastState(room) {
    for (const player of room.players) {
      if (player.connected) {
        io.to(player.id).emit('gameState', getRoomState(room, player.id));
      }
    }
  }
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Cards Against Humanity rodando em http://localhost:${PORT}\n`);
});
