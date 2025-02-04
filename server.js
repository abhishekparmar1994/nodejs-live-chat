const { log } = require('console');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // Add fetch for making API requests

const notifier = require('node-notifier');

const hostname = "192.168.1.149";  // Use the actual hostname or IP
// const hostname = "127.0.0.1";  // Use the actual hostname or IP
const port = 3000;
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let onlineUsers = {}; // Object to store socket id and username mapping

app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'chat_db'
});

db.connect(err => {
  if (err) throw err;
  console.log('MySQL connected...');
  
  // Run migrations
  const createMessagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      message TEXT,
      image VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createMessagesTable, (err) => {
    if (err) throw err;
    console.log('Messages table ensured.');
  });

  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createUsersTable, (err) => {
    if (err) throw err;
    console.log('Users table ensured.');
  });
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, 'your_jwt_secret', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// API to handle login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
    if (err) throw err;
    if (results.length > 0) {
      const token = jwt.sign({ username }, 'your_jwt_secret', { expiresIn: '1h' });
      res.json({ token });
    } else {
      res.sendStatus(401);
    }
  });
});

// API to handle registration
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
    if (err) throw err;
    if (results.length > 0) {
      res.status(409).json({ message: 'User already exists' });
    } else {
      db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], (err) => {
        if (err) throw err;
        const token = jwt.sign({ username }, 'your_jwt_secret', { expiresIn: '1h' });
        res.status(201).json({ token });
      });
    }
  });
});

// API to get messages
app.get('/api/messages', authenticateToken, (req, res) => {
  db.query('SELECT * FROM messages', (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// API to post a new message
app.post('/api/messages', authenticateToken, (req, res) => {
  const { name, message, image } = req.body;
  db.query('INSERT INTO messages (name, message, image) VALUES (?, ?, ?)', [name, message, image], (err) => {
    if (err) throw err;
    res.sendStatus(201);
  });
});

// API to get online users
app.get('/api/online-users', authenticateToken, (req, res) => {
  res.json(Object.values(onlineUsers));
});

// API to search for GIFs
app.get('/api/search-gifs', authenticateToken, (req, res) => {
  const query = req.query.q;

  console.log('query'+query);
  const apiKey = 'LCf4OpkWro3TIcRuFl4HeMwa0vA4HNOC'; // Replace with your Giphy API key
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${query}&limit=10`;

  fetch(url)
    .then(response => response.json())
    .then(data => res.json(data.data))
    .catch(err => res.status(500).json({ error: 'Failed to fetch GIFs' }));
});

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // Listen for the user to set their username
  socket.on('setUserName', (userName) => {
    console.log(`User ${userName} connected`);
    onlineUsers[socket.id] = userName;  // Store username with socket id
    io.emit('onlineUsers', Object.values(onlineUsers));  // Emit the updated list to all clients
    console.log(`${userName} is now online`);
  });

  // Listen for incoming chat messages from clients
  socket.on('chatMessage', (data) => {
    const message = {
      id: socket.id,
      name: data.name,
      message: data.message || null,
      image: data.image || null,
    };
    io.emit('chatMessage', message); // Broadcast the message
  });

  // Send a new message (triggering the notification on the client side)
  socket.on('sendMessage', (messageData) => {
    // Emitting the new message with sender and content to all users
    io.emit('newMessage', { 
      sender: messageData.sender, 
      content: messageData.content 
    });
  });

  // Listen for incoming GIF messages from clients
  socket.on('gifMessage', (data) => {
    const message = {
      id: socket.id,
      name: data.name,
      gifUrl: data.gifUrl,
    };
    io.emit('gifMessage', message); // Broadcast the GIF message
  });

  // Listen for typing event
  socket.on('typing', (userName) => {
    socket.broadcast.emit('userTyping', userName);  // Broadcast typing status to others
    console.log(`${userName} is typing...`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const userName = onlineUsers[socket.id];  // Get the username of the disconnected user
    console.log('userName'+userName);
    delete onlineUsers[socket.id];  // Remove from onlineUsers object
    io.emit('onlineUsers', Object.values(onlineUsers)); // Broadcast updated list of online users
    console.log(`${userName} disconnected`);
  });
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

