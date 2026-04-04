const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { blackCards, whiteCards, expansions } = require('./cards');

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
      submittedCards: [],
      connected: true
    }],
    state: 'lobby', // lobby, playing, judging, roundEnd, gameOver
    activeExpansions: [],
    customBlackCards: [...blackCards],
    customWhiteCards: [...whiteCards],
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
  let finalBlack = [...blackCards];
  let finalWhite = [...whiteCards];

  room.activeExpansions.forEach(packId => {
    if (expansions && expansions[packId]) {
      finalBlack.push(...expansions[packId].blackCards);
      finalWhite.push(...expansions[packId].whiteCards);
    }
  });

  room.customBlackCards = finalBlack;
  room.customWhiteCards = finalWhite;

  room.blackDeck = shuffleArray(finalBlack);
  room.whiteDeck = shuffleArray(finalWhite);
}

function dealCards(room, count = 7) {
  for (const player of room.players) {
    while (player.hand.length < count) {
      if (room.whiteDeck.length === 0) {
        room.whiteDeck = shuffleArray(room.customWhiteCards || whiteCards);
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
    player.submittedCards = [];
  }

  // Draw black card
  if (room.blackDeck.length === 0) {
    room.blackDeck = shuffleArray(room.customBlackCards || blackCards);
  }
  const text = room.blackDeck.pop();
  const pickCount = Math.max(1, (text.match(/_+/g) || []).length);
  room.currentBlackCard = { text: text, pick: pickCount };

  // Deal up to 10 cards per player (to support multiple submissions comfortably)
  dealCards(room, 10);
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
      hasSubmitted: p.submittedCards.length > 0,
      isCzar: getCzar(room) && getCzar(room).id === p.id
    })),
    hand: player ? player.hand : [],
    currentBlackCard: room.currentBlackCard,
    isCzar: isCzar,
    czarName: czar ? czar.name : '',
    submissions: room.state === 'judging'
      ? room.submissions.map((s, idx) => s.revealed ? { ...s, index: idx, hidden: false } : { index: idx, hidden: true, cards: s.cards.map(() => '???') })
      : room.state === 'roundEnd'
      ? room.submissions.map((s, idx) => ({ ...s, index: idx, hidden: false }))
      : [],
    roundWinner: room.roundWinner,
    isHost: room.hostId === playerId,
    pointsToWin: room.pointsToWin,
    roundNumber: room.roundNumber,
    minPlayers: room.minPlayers,
    availableExpansions: expansions,
    activeExpansions: room.activeExpansions
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
      // Clear the disconnect timer instantly so they don't get kicked
      if (existingPlayer.disconnectTimer) {
        clearTimeout(existingPlayer.disconnectTimer);
        existingPlayer.disconnectTimer = null;
      }
      // Forcefully disconnect the old ghost socket if the server thinks they are still connected
      if (existingPlayer.connected && existingPlayer.id !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existingPlayer.id);
        if (oldSocket) {
          oldSocket.disconnect(true);
        }
      }
      
      // Update session with new socket
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
      submittedCards: [],
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

  socket.on('toggleExpansion', ({ packId, enabled }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== playerId || room.state !== 'lobby') return;
    
    if (enabled && !room.activeExpansions.includes(packId)) {
      room.activeExpansions.push(packId);
    } else if (!enabled) {
      room.activeExpansions = room.activeExpansions.filter(id => id !== packId);
    }
    broadcastState(room);
  });

  socket.on('submitCard', ({ cardIndices }) => {
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

    if (player.submittedCards.length > 0) {
      socket.emit('error', { message: 'Você já submeteu suas cartas!' });
      return;
    }

    const expectedPicks = room.currentBlackCard.pick || 1;
    if (!Array.isArray(cardIndices) || cardIndices.length !== expectedPicks) {
      socket.emit('error', { message: `Esta carta exige ${expectedPicks} resposta(s).` });
      return;
    }

    // Ensure unique and valid indices
    const uniqueIndices = [...new Set(cardIndices)];
    if (uniqueIndices.length !== expectedPicks) {
      socket.emit('error', { message: 'Você enviou índices repetidos!' });
      return;
    }

    for (const idx of uniqueIndices) {
      if (idx < 0 || idx >= player.hand.length) return;
    }

    // Capture cards in exact selection order
    const selectedCards = cardIndices.map(idx => player.hand[idx]);

    // Remove from hand (sort descending to not mess up earlier indices)
    const sortedIndices = [...cardIndices].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      player.hand.splice(idx, 1);
    }

    player.submittedCards = selectedCards;
    room.submissions.push({
      playerId: player.id,
      playerName: player.name,
      cards: selectedCards,
      revealed: false
    });

    broadcastState(room);

    // Check if all non-czar players have submitted
    const activePlayers = getActivePlayers(room);
    const nonCzar = activePlayers.filter(p => {
      return getCzar(room) && p.id !== getCzar(room).id;
    });
    const allSubmitted = nonCzar.every(p => p.submittedCards.length > 0);

    if (allSubmitted) {
      room.state = 'judging';
      // Shuffle submissions so czar can't guess who submitted what
      room.submissions = shuffleArray(room.submissions);
      broadcastState(room);
    }
  });

  socket.on('revealSubmission', ({ index }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'judging') return;

    const czar = getCzar(room);
    if (!czar || czar.id !== playerId) return;

    if (index >= 0 && index < room.submissions.length) {
      room.submissions[index].revealed = true;
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
      cards: winner.cards,
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
      player.submittedCards = [];
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
      player.submittedCards = [];
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
    if (!player) return;

    // Give a 60-second grace period before officially disconnecting to prevent mobile stutter
    player.disconnectTimer = setTimeout(() => {
      player.connected = false;
      io.to(currentRoom).emit('playerLeft', { playerName: player.name });

      // If in lobby and player disconnects, remove them
      if (room.state === 'lobby') {
        room.players = room.players.filter(p => p.id !== player.id);
        
        if (room.hostId === player.id) {
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
        if (czar && czar.id === player.id) {
          advanceCzar(room);
          if (getActivePlayers(room).length >= room.minPlayers) {
            startRound(room);
          } else {
            room.state = 'lobby';
          }
        } else if (room.state === 'playing') {
          // If a regular player disconnected, check if we can advance to judging
          const nonCzar = activePlayers.filter(p => getCzar(room) && p.id !== getCzar(room).id);
          const allSubmitted = nonCzar.length > 0 && nonCzar.every(p => p.submittedCards.length > 0);
          if (allSubmitted) {
            room.state = 'judging';
            room.submissions = shuffleArray(room.submissions);
          }
        }
      }

      broadcastState(room);
    }, 300000); // 5 minutes (300.000 ms)
  });

  socket.on('leaveRoom', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    const player = room.players[playerIndex];

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }
    
    // Instantly remove player completely
    room.players.splice(playerIndex, 1);
    io.to(currentRoom).emit('playerLeft', { playerName: player.name });
    
    // Re-assign host
    if (room.hostId === player.id) {
      if (room.players.length > 0) {
        room.hostId = room.players[0].id;
      } else {
        rooms.delete(currentRoom);
        socket.leave(currentRoom);
        currentRoom = null;
        return;
      }
    }

    // Clean up empty rooms
    const activePlayers = getActivePlayers(room);
    if (activePlayers.length === 0) {
      rooms.delete(currentRoom);
      socket.leave(currentRoom);
      currentRoom = null;
      return;
    }

    // If czar left, advance game state
    if (room.state === 'playing' || room.state === 'judging') {
      const czar = getCzar(room);
      if (czar && czar.id === player.id) {
        advanceCzar(room);
        if (getActivePlayers(room).length >= room.minPlayers) {
          startRound(room);
        } else {
          room.state = 'lobby';
        }
      } else if (room.state === 'playing') {
        const nonCzar = activePlayers.filter(p => getCzar(room) && p.id !== getCzar(room).id);
        const allSubmitted = nonCzar.length > 0 && nonCzar.every(p => p.submittedCards.length > 0);
        if (allSubmitted) {
          room.state = 'judging';
          room.submissions = shuffleArray(room.submissions);
        }
      }
    }

    // Remove player submission if they had one
    room.submissions = room.submissions.filter(s => s.player !== player.name);

    broadcastState(room);
    socket.leave(currentRoom);
    currentRoom = null;
  });

  socket.on('luckyDraw', () => {
    let poolBlack = [...blackCards];
    let poolWhite = [...whiteCards];
    
    if (expansions) {
      Object.values(expansions).forEach(pack => {
        if (pack.blackCards) poolBlack.push(...pack.blackCards);
        if (pack.whiteCards) poolWhite.push(...pack.whiteCards);
      });
    }

    if (poolBlack.length === 0 || poolWhite.length === 0) return;
    const randomBlackStr = poolBlack[Math.floor(Math.random() * poolBlack.length)];
    const pickCount = Math.max(1, (randomBlackStr.match(/_+/g) || []).length);
    
    const chosenWhites = [];
    for(let i = 0; i < pickCount; i++) {
        chosenWhites.push(poolWhite[Math.floor(Math.random() * poolWhite.length)]);
    }

    socket.emit('luckyResult', { 
        blackCard: { text: randomBlackStr, pick: pickCount }, 
        whiteCards: chosenWhites 
    });
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
