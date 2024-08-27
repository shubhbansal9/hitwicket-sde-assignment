const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    fs.readFile(path.join(__dirname, "index.html"), (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end("Error loading index.html");
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocket.Server({ server });
const games = new Map();
let waitingPlayer = null;

class Game {
  constructor(player1, player2) {
    this.board = Array(5)
      .fill(null)
      .map(() => Array(5).fill(null));
    this.players = [player1, player2];
    this.currentPlayerIndex = 0;
    this.characters = new Map();
    this.setupPhase = true;
    this.setupCount = 0;
    this.spectators = new Set();
    this.moveHistory = [];
  }

  initializeGame(playerIndex, setup) {
    const row = playerIndex === 0 ? 4 : 0;
    const prefix = playerIndex === 0 ? "A-" : "B-";
    setup.forEach((char, col) => {
      if (!["P", "H", "2", "3"].includes(char)) {
        throw new Error(`Invalid character type: ${char}`);
      }
      const fullName = `${prefix}${char}${col + 1}`;
      this.board[row][col] = fullName;
      this.characters.set(fullName, { row, col, type: char });
    });
    this.setupCount++;
    // console.log(`Player ${playerIndex} setup complete:`, this.characters);

    if (this.setupCount === 2) {
      this.setupPhase = false;
      return true;
    }
    return false;
  }
  makeMove(player, characterName, move) {
    if (player === 1) {
      switch (move) {
          case "BR":
              move = "FR";
              break;
          case "BL":
              move = "FL";
              break;
          case "FR":
              move = "BR";
              break;
          case "FL":
              move = "BL";
              break;
          case "RB":
              move = "RF";
              break;
          case "RF":
              move = "RB";
              break;
          case "LF":
              move = "LB";
              break;
          case "LB":
              move = "LF";
              break;
          default:
              if (characterName.startsWith("P")) {
                  switch (move) {
                      case "L":
                          move = "R";
                          break;
                      case "R":
                          move = "L";
                          break;
                  }
              }
              break;
      }
    }
    // console.log(
    //   `Attempting move: Player ${player}, Character ${characterName}, Move ${move}`
    // );
    if (player !== this.currentPlayerIndex) {
      return { success: false, message: "Not your turn" };
    }

    const prefix = player === 0 ? "A-" : "B-";
    const fullCharacterName = `${prefix}${characterName}`;
    const character = this.characters.get(fullCharacterName);

    if (!character) {
      // console.log(`Character not found: ${fullCharacterName}`);
      // console.log("Available characters:", Array.from(this.characters.keys()));
      return {
        success: false,
        message: `Character not found: ${characterName}`,
      };
    }

    let [dx, dy] = [0, 0];
    let steps = 1;

    switch (character.type) {
      case "P":
        [dx, dy] = this.getPawnMove(move, player);
        break;
      case "H":
        [dx, dy] = this.getHero1Move(move, player);
        steps = 2;
        break;
      case "2":
        [dx, dy] = this.getHero2Move(move, player);
        break;
      case "3":
        [dx, dy] = this.getHero3Move(move, player);
        break;
      default:
        return { success: false, message: "Invalid character type" };
    }

    if (dx === 0 && dy === 0) {
      return { success: false, message: "Invalid move" };
    }

    let newRow = character.row + dy;
    let newCol = character.col + dx;
    if (newRow < 0 || newRow >= 5 || newCol < 0 || newCol >= 5) {
      return { success: false, message: "Move out of bounds" };
    }
    if (
      character.type === "H" ||
      character.type === "2" ||
      character.type === "3"
    ) {
      const pathCells = this.getPathCells(character.row, character.col, dx, dy);
      // console.log(`Path cells for ${character.type}:`, pathCells);
      for (const [row, col] of pathCells) {
        if (row < 0 || row >= 5 || col < 0 || col >= 5) {
          // console.log(`Move out of bounds: (${row}, ${col})`);
          return { success: false, message: "Move out of bounds" };
        }
        const targetChar = this.board[row][col];
        if (targetChar && !targetChar.startsWith(prefix)) {
          if (
            character.type === "3" &&
            row === pathCells[pathCells.length - 1][0] &&
            col === pathCells[pathCells.length - 1][1]
          ) {
            this.characters.delete(targetChar);
            this.board[row][col] = null;
          } else if (character.type === "H" || character.type === "2") {
            this.characters.delete(targetChar);
            this.board[row][col] = null;
          }
        }
      }
      [newRow, newCol] = pathCells[pathCells.length - 1];
    } else {
      const targetChar = this.board[newRow][newCol];
      if (targetChar) {
        if (targetChar.startsWith(prefix)) {
          return {
            success: false,
            message: "Cannot move to friendly character",
          };
        }
        this.characters.delete(targetChar);
      }
    }

    this.board[character.row][character.col] = null;
    this.board[newRow][newCol] = fullCharacterName;
    character.row = newRow;
    character.col = newCol;
    const playerPrefix = player === 0 ? "A" : "B";
    const correctedMove = this.correctMoveForHistory(player, characterName, move);
    this.moveHistory.push(`${playerPrefix}- ${characterName}:${correctedMove}`);

    this.currentPlayerIndex = 1 - this.currentPlayerIndex;
    // console.log(
    //   `Move successful: ${fullCharacterName} to (${newRow}, ${newCol})`
    // );
    return { success: true };
  }
  correctMoveForHistory(player, characterName, move) {
    if (player === 1) {
      const charType = characterName[0];
      if (charType === 'P' || charType === 'H') {
        switch (move) {
          case 'F': return 'B';
          case 'B': return 'F';
          case 'L': return 'R';
          case 'R': return 'L';
          default: return move;
        }
      }
    }
    return move;
  }
  getPawnMove(move, player) {
    switch (move) {
      case "L":
        return [-1, 0];
      case "R":
        return [1, 0];
      case "F":
        return [0, -1];
      case "B":
        return [0, 1];
      default:
        return [0, 0];
    }
  }

  getHero1Move(move, player) {
    if (player == 1) {
      if (move == "L") {
        move = "R";
      } else if (move == "R") {
        move = "L";
      }
    }
    const [dx, dy] = this.getPawnMove(move, player);
    return [dx * 2, dy * 2];
  }

  getHero2Move(move, player) {
    // console.log(`getHero2Move called with move: ${move}, player: ${player}`);
    let result;
    switch (move) {
      case "FL":
        result = [-2, -2];
        break;
      case "FR":
        result = [2, -2];
        break;
      case "BL":
        result = [-2, 2];
        break;
      case "BR":
        result = [2, 2];
        break;
      default:
        console.log(`Invalid move for Hero2: ${move}`);
        return [0, 0];
    }
    if (player === 1) {
      result = result.map((x) => -x);
    }
    console.log(`Hero2 move result:`, result);
    return result;
  }

  getHero3Move(move, player) {
    let moveMap = {
      FL: [-1, -2],
      FR: [1, -2],
      BL: [-1, 2],
      BR: [1, 2],
      RF: [2, -1],
      RB: [2, 1],
      LF: [-2, -1],
      LB: [-2, 1],
    };

    let moveVector = moveMap[move];

    if (player === 1) {
      moveVector = moveVector.map((coord) => -coord);
    }

    return moveVector;
  }
  getPathCells(startRow, startCol, dx, dy) {
    const cells = [];
    let row = startRow,
      col = startCol;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 0; i < steps; i++) {
      row += dy / steps;
      col += dx / steps;
      cells.push([Math.round(row), Math.round(col)]);
    }
    // console.log(
    //   `getPathCells: start=(${startRow},${startCol}), dx=${dx}, dy=${dy}, result:`,
    //   cells
    // );
    return cells;
  }

  isGameOver() {
    const aCharacters = Array.from(this.characters.keys()).filter((k) =>
      k.startsWith("A")
    );
    const bCharacters = Array.from(this.characters.keys()).filter((k) =>
      k.startsWith("B")
    );
    if (aCharacters.length === 0) return "B";
    if (bCharacters.length === 0) return "A";
    return null;
  }

  getGameState() {
    return {
      board: this.board,
      currentPlayer: this.currentPlayerIndex,
      setupPhase: this.setupPhase,
      moveHistory: this.moveHistory,
    };
  }

  addSpectator(ws) {
    this.spectators.add(ws);
    ws.send(
      JSON.stringify({
        type: "gameState",
        state: this.getGameState(),
        playerIndex: -1,
      })
    );
  }

  removeSpectator(ws) {
    this.spectators.delete(ws);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);
    handleMessage(ws, data);
  });

  ws.on("close", () => {
    if (waitingPlayer === ws) {
      waitingPlayer = null;
    }
    games.forEach((game, id) => {
      if (game.players.includes(ws)) {
        const otherPlayer = game.players.find((p) => p !== ws);
        if (otherPlayer) {
          otherPlayer.send(
            JSON.stringify({ type: "gameOver", reason: "opponentDisconnected" })
          );
        }
        games.delete(id);
      }
      game.removeSpectator(ws);
    });
  });
});

function handleMessage(ws, data) {
  switch (data.type) {
    case "join":
      handleJoin(ws);
      break;
    case "setup":
      handleSetup(ws, data);
      break;
    case "move":
      handleMove(ws, data);
      break;
    case "spectate":
      handleSpectate(ws, data);
      break;
  }
}

function handleJoin(ws) {
  if (waitingPlayer) {
    const gameId = Math.random().toString(36).substring(7);
    const game = new Game(waitingPlayer, ws);
    games.set(gameId, game);
    waitingPlayer.send(
      JSON.stringify({ type: "gameStart", playerIndex: 0, gameId })
    );
    ws.send(JSON.stringify({ type: "gameStart", playerIndex: 1, gameId }));
    waitingPlayer = null;
  } else {
    waitingPlayer = ws;
    ws.send(JSON.stringify({ type: "wait" }));
  }
}

function handleSetup(ws, data) {
  const game = games.get(data.gameId);
  if (!game) return;

  const playerIndex = game.players.indexOf(ws);
  const gameReady = game.initializeGame(playerIndex, data.setup);

  if (gameReady) {
    game.players.forEach((player, index) => {
      player.send(
        JSON.stringify({
          type: "gameReady",
          state: game.getGameState(),
          playerIndex: index,
        })
      );
    });
  } else {
    ws.send(JSON.stringify({ type: "setupComplete" }));
  }
}

function handleMove(ws, data) {
  const game = games.get(data.gameId);
  if (!game) {
    ws.send(JSON.stringify({ type: "error", message: "Game not found" }));
    return;
  }

  const playerIndex = game.players.indexOf(ws);
  // console.log(`Received move from player ${playerIndex}:`, data);
  const result = game.makeMove(playerIndex, data.character, data.move);

  if (result.success) {
    const gameOver = game.isGameOver();
    const updateData = {
      type: gameOver ? "gameOver" : "gameState",
      state: game.getGameState(),
      winner: gameOver,
    };

    game.players.forEach((player, index) => {
      player.send(
        JSON.stringify({
          ...updateData,
          playerIndex: index,
        })
      );
    });

    game.spectators.forEach((spectator) => {
      spectator.send(
        JSON.stringify({
          ...updateData,
          playerIndex: -1,
        })
      );
    });
  } else {
    ws.send(JSON.stringify({ type: "error", message: result.message }));
  }
}

function handleSpectate(ws, data) {
  const game = games.get(data.gameId);
  if (!game) {
    ws.send(JSON.stringify({ type: "error", message: "Game not found" }));
    return;
  }
  game.addSpectator(ws);
}

server.listen(8080, () => {
  console.log("Server is listening on port 8080");
});
