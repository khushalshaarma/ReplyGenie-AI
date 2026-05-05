const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./db');
const initSocket = require('./socket');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// routes
app.use('/api/suggestions', require('./routes/suggestions'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/ai', require('./routes/ai'));

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

// Socket.IO
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });
initSocket(io);

connectDB().catch(err => {
  console.error('DB connection failed', err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
