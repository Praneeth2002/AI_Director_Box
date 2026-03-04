import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend connected to AI Director orchestrator');

    ws.on('message', (message) => {
        console.log('received:', message.toString());
    });

    ws.send(JSON.stringify({ type: 'status', data: 'AI Director Sandbox Ready' }));
});

const PORT = process.env.PORT || 8080;

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'AI Director Orchestrator' });
});

server.listen(PORT, () => {
    console.log(`AI Director Backend listening on port ${PORT}`);
});
