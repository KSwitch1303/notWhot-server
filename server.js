require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http');
const { Server } = require("socket.io");
const port = 5003;
const mongoose = require('mongoose')
const cors = require('cors');
const bcrypt = require('bcrypt');

app.use(cors());
app.use(express.json());

const User = require('./models/userSchema')
const Transaction = require('./models/transactionSchema');
const { time } = require('console');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

// Object to store room-specific data
const rooms = {};
const roomCodes = {
  100: {},
  200: {},
  500: {},
};


io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("createRoom", (data) => {
    const { roomCode, username } = data;
    socket.join(roomCode);
    console.log(`User with ID: ${socket.id} and name ${username} Created room: ${roomCode}`);

    // Initialize room with the creating player and an empty market
    rooms[roomCode] = {
      players: {
        [username]: {
          username: username,
          cards: [],
          wager: 100,
          turn: true,
          status: "waiting",
        },
      },
      timer: 0,
      market: [],
      playedCards: [],
      currentPlayerIndex: 0,
    };
  });

  socket.on("joinRoom", (data) => {
    const { username, lobbyName } = data;
    let len = Object.keys(roomCodes[lobbyName]).length - 1;
    let roomCode = '';
    console.log(roomCodes[lobbyName]);
    if (roomCodes[lobbyName][len]) {
      console.log('not empty');
      console.log(roomCodes[lobbyName][len].players);
      if (roomCodes[lobbyName][len].players === 1) {
        socket.join(roomCodes[lobbyName][len].roomCode);
        roomCodes[lobbyName][len].players++;
        console.log('joined room');
        roomCode = roomCodes[lobbyName][len].roomCode;
        rooms[roomCode].players[username] = {
          username: username,
          cards: [],
          wager: 100,
          turn: false,
          status: "waiting",
        };
        console.log(roomCodes[lobbyName]);
        console.log(rooms[roomCode]);
      } else {
        console.log('creating new room');
        roomCode = socket.id + '-' + Math.floor(Math.random() * 1000000000);
        roomCodes[lobbyName][len + 1] = {
          roomCode: roomCode,
          players: 1,
        };
        console.log('Created another room');
        InitializeRoom(roomCode, username);
        console.log(roomCodes[lobbyName]);
        socket.join(roomCode);
      }
    } else {
      console.log('empty');
      // generate room code
      roomCode = socket.id + '-' + Math.floor(Math.random() * 1000000000);
      roomCodes[lobbyName][0] = {
        roomCode: roomCode,
        players: 1,
      };
      InitializeRoom(roomCode, username);
      console.log('Created room');
      console.log(roomCodes[lobbyName]);
      socket.join(roomCode);
    }
    
    // let roomCode = roomCodes[lobbyName][len].roomCode;
    io.to(socket.id).emit("roomCode", { roomCode: roomCode });

   

    // // Add the new player to the room

    // // Notify existing users in the room about the new player
    socket.to(roomCode).emit("userJoined", { username, userID: socket.id });

    // // Send the updated player list to all users in the room
    io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards });
  });

  socket.on("leaveRoom", (data) => {
    const { roomCode, username } = data;
    socket.leave(roomCode);
    console.log(`User with ID: ${socket.id} and name ${username} left room: ${roomCode}`);

    // Remove the player from the room
    if (rooms[roomCode]) {
      delete rooms[roomCode].players[username];
      // If the room is empty, you can optionally delete it
      if (Object.keys(rooms[roomCode].players).length === 0) {
        delete rooms[roomCode];
      } else {
        // Notify remaining users in the room about the player leaving
        socket.to(roomCode).emit("userLeft", { username, userID: socket.id });

        // Send the updated player list to all users in the room
        io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players });
      }
    }
  });

  socket.on("updatePlayers", (data) => {
    const { roomCode, players } = data;
    rooms[roomCode].players = players;
    io.in(roomCode).emit("playersUpdated", { players });
  });

  socket.on("updatePlayedCards", (data) => {
    const { roomCode } = data;
    playedCards = rooms[roomCode].playedCards;
    console.log(playedCards);
    io.in(roomCode).emit("playersUpdated", { playedCards, normalCardPlayed: true });
  });

  socket.on("ready", (data) => {
    const { roomCode, username } = data;
    if (Object.keys(rooms[roomCode].players).length === 1) {
      return;
    }
    rooms[roomCode].players[username].status = "ready";
    io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players });
    // check if room is more than 1 player
    
    // Check if all players are ready
    const readyPlayers = Object.values(rooms[roomCode].players).filter((player) => player.status === "ready");
    if (readyPlayers.length === Object.keys(rooms[roomCode].players).length) {
      console.log(`Starting game in room: ${roomCode}`);
      // Generate Cards
      const market = generateMarket();
      rooms[roomCode].market = market;

      // Distribute cards to players
      distributeCards(roomCode);

      // Determine the first player to start the game
      const playerKeys = Object.keys(rooms[roomCode].players);
      rooms[roomCode].currentPlayerIndex = 0;
      rooms[roomCode].players[playerKeys[rooms[roomCode].currentPlayerIndex]].turn = true;

      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards });

      // Emit the startGame event to the room with the updated player data
      io.in(roomCode).emit("startGame", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards, normalCardPlayed: true });
      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards });
    }
  });

  socket.on("playCard", async (data) => {
    const { roomCode, username, card, need } = data;

    if (rooms[roomCode].players[username].turn) {
      // Remove the played card from the player's hand
      rooms[roomCode].players[username].cards = rooms[roomCode].players[username].cards.filter((c) => c !== card);
      rooms[roomCode].playedCards.push(card);

      // Move to the next player's turn
      await passTurn(roomCode);
      refillMarket(roomCode);
      for (const player in rooms[roomCode].players) {
        const playerObj = rooms[roomCode].players[player];
        console.log(playerObj);
        if (playerObj.cards.length === 0) {
          gameWon(roomCode, player);
        }
      }
      if (need) {
        console.log(need);
        io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, playedCards: rooms[roomCode].playedCards, market: rooms[roomCode].market, normalCardPlayed: false, need: need, cardNeeded: true});
        return;
      }

      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, playedCards: rooms[roomCode].playedCards, market: rooms[roomCode].market, normalCardPlayed: true});
    }
  });

  socket.on("pickTwo", async (data) => {
    const { roomCode, username } = data;
    if (rooms[roomCode].players[username].turn) {
      rooms[roomCode].players[username].cards.push(rooms[roomCode].market.shift());
      rooms[roomCode].players[username].cards.push(rooms[roomCode].market.shift());
      await passTurn(roomCode);
      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards, normalCardPlayed: false});
    }
  });

  socket.on("holdOn", async (data) => {
    const { roomCode, username } = data;

    if (rooms[roomCode].players[username].turn) {
      await passTurn(roomCode);

      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards, normalCardPlayed: false});
    }
      
  })

  socket.on("generalMarket", async (data) => {
    const { roomCode, username } = data;

    if (rooms[roomCode].players[username].turn) {
      rooms[roomCode].players[username].cards.push(rooms[roomCode].market.shift());
      await passTurn(roomCode);

      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards, normalCardPlayed: false});
    }
  })

  socket.on("useMarket", (data) => {
    const { roomCode, username, need } = data;

    if (rooms[roomCode].players[username].turn) {
      rooms[roomCode].players[username].cards.push(rooms[roomCode].market.shift());

      // Move to the next player's turn
      passTurn(roomCode);
      refillMarket(roomCode);
      
      if (need) {
        console.log(need);
        io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, playedCards: rooms[roomCode].playedCards, market: rooms[roomCode].market, normalCardPlayed: false, need: need, cardNeeded: true});
        return;
      }

      io.in(roomCode).emit("playersUpdated", { players: rooms[roomCode].players, market: rooms[roomCode].market, playedCards: rooms[roomCode].playedCards });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
    // Logic to handle player disconnection (if needed)
  });
});

const InitializeRoom = (roomCode, username) => {
  rooms[roomCode] = {
    players: {
      [username]: {
        username: username,
        cards: [],
        wager: 100,
        turn: true,
        status: "waiting",
      },
    },
    market: [],
    playedCards: [],
    currentPlayerIndex: 0,
  };
}
const refillMarket = (roomCode) => {
  if (rooms[roomCode].market.length === 1) {
    //take the played cards and refill the market but leave the last card
    for (let i = 0; i < rooms[roomCode].playedCards.length - 1; i++) {
      rooms[roomCode].market.push(rooms[roomCode].playedCards[i]);
    }
    rooms[roomCode].playedCards = [rooms[roomCode].playedCards[rooms[roomCode].playedCards.length - 1]];
    //shuffle the market
    rooms[roomCode].market = rooms[roomCode].market.sort(() => Math.random() - 0.5);
    console.log(rooms[roomCode]);
    // console.log(rooms[roomCode].market);
  }
}

const gameWon = (roomCode, winner) => {
  io.in(roomCode).emit("gameWon", { winner: winner });
}
const generateMarket = () => {
  const market = [];
  const cardNamesandValues = {
    "c": [12, 3, 4, 1, 7, 5, 10, 14, 8, 2, 11, 13],
    "t": [10, 8, 11, 7, 14, 13, 5, 2, 12, 3, 4, 1],
    "x": [14, 10, 5, 7, 11, 3, 2, 1, 13],
    "s": [3, 14, 5, 10, 7, 1, 2, 13, 11],
    "r": [5, 4, 1, 7, 3, 8, 2],
    "w": [20, 21, 22, 23, 24]
  };

  // Combine all cards into a single array
  const allCards = [];
  for (const [cardType, values] of Object.entries(cardNamesandValues)) {
    for (const value of values) {
      allCards.push(`${cardType}-${value}`);
    }
  }

  // Shuffle the array
  const shuffledCards = allCards.sort(() => Math.random() - 0.5);

  // Add shuffled cards to the market array
  market.push(...shuffledCards);

  return market;
};

const distributeCards = (roomCode) => {
  const numCardsPerPlayer = 5;
  const market = rooms[roomCode].market;

  for (const player of Object.values(rooms[roomCode].players)) {
    player.cards = market.splice(0, numCardsPerPlayer);
  }

  // Add one card to the playedCards array
  rooms[roomCode].playedCards.push(market.shift());

  // Update the room market with the remaining cards
  rooms[roomCode].market = market;
};

const passTurn = (roomCode) => {
  const playerKeys = Object.keys(rooms[roomCode].players);
  const numPlayers = playerKeys.length;

  // Set the current player's turn to false
  rooms[roomCode].players[playerKeys[rooms[roomCode].currentPlayerIndex]].turn = false;

  // Move to the next player
  rooms[roomCode].currentPlayerIndex = (rooms[roomCode].currentPlayerIndex + 1) % numPlayers;

  // Set the next player's turn to true
  rooms[roomCode].players[playerKeys[rooms[roomCode].currentPlayerIndex]].turn = true;
};



app.post("/signup", async (req, res) => {
  const { username, password, bank, accountNo, accountName } = req.body;
  console.log(req.body);
  const userExists = await checkIfUserExists(username);
  if (userExists) {
    res.status(201).json({ message: "User already exists" });
    return;
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({
    username,
    password: hashedPassword,
    bank,
    accountNo,
    accountName
  });
  try {
    await user.save();
    res.status(200).json({ message: "User created successfully", success: true });
  } catch (error) {
    console.error(error);
    res.status(201).json({ message: "Error creating user" });
  }
})

const checkIfUserExists = async (username) => {
  const user = await User.findOne({ username });
  if (user) {
    return true;
  } else {
    return false;
  }
}

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) {
    res.status(201).json({ message: "User does not exist" });
    return;
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(201).json({ message: "Invalid credentials" });
    return;
  }
  res.status(200).json({ message: "Login successful", success: true, user });
})

app.post("/update", async (req, res) => {
  const { username, bank, accountNo, accountName } = req.body;
  const user = await User.findOne({ username });
  user.bank = bank;
  user.accountNo = accountNo;
  user.accountName = accountName;
  try {
    await user.save();
    res.status(200).json({ message: "User updated successfully", success: true });
  } catch (error) {
    console.error(error);
    res.status(201).json({ message: "Error updating user" });
  }
})

app.post("/addTransaction", async (req, res) => {
  const { sender, amount, receiver, tno } = req.body;
  console.log(req.body);
  const transaction = new Transaction({
    sender,
    receiver,
    amount,
    tno
  })
  try {
    await transaction.save();
    res.status(200).json({ message: "Transaction added successfully", success: true });
  } catch (error) {
    console.error(error);
    res.status(201).json({ message: "Error adding transaction" });
  }
})

app.get("/getTransactions", async (req, res) => {
  const unsorted_transactions = await Transaction.find({});
  // sort by the latest
  const transactions = unsorted_transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.status(200).json({ message: "Transactions fetched successfully", success: true, transactions });
})

app.get("/getTransactions/:username", async (req, res) => {
  const { username } = req.params;
  const unsorted_transactions = await Transaction.find({ sender: username });
  // sort by the latest
  const transactions = unsorted_transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.status(200).json({ message: "Transactions fetched successfully", success: true, transactions });
})

app.post("/updateTransaction", async (req, res) => {
  const { transactionId, status } = req.body;
  const transaction = await Transaction.findById(transactionId);
  transaction.status = status;
  try {
    await transaction.save();
    res.status(200).json({ message: "Transaction approved successfully", success: true });
  } catch (error) {
    console.error(error);
    res.status(201).json({ message: "Error approving transaction" });
  }
})

app.get("/paystackInit", async (req, res) => {
  // const { amount, email } = req.body;
  amount = 1000 * 100
  email = "XtTq0@example.com"
  const https = require('https')

  const params = JSON.stringify({
    "email": email,
    "amount": amount
  })

  const options = {
    hostname: 'api.paystack.co',
    port: 443,
    path: '/transaction/initialize',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    }
  }

  const reqPaystack = https.request(options, resPaystack => {
    let data = ''

    resPaystack.on('data', (chunk) => {
      data += chunk
    });

    resPaystack.on('end', () => {
      res.send(JSON.parse(data).data)
      console.log(JSON.parse(data))
    })
  }).on('error', error => {
    console.error(error)
  })

  reqPaystack.write(params)
  reqPaystack.end()
})


mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    server.listen(port, () => {
      console.log(`listening on *:${port}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });

