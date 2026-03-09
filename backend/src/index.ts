import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import { runAnalyst } from './agents/TheAnalyst';
import { runCommentator } from './agents/TheCommentator';
import { runDirector } from './agents/TheDirector';

dotenv.config();

// Auth diagnostic — helps verify credentials are pointed correctly
const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
console.log(`[Auth] GOOGLE_APPLICATION_CREDENTIALS = ${credsPath}`);
console.log(`[Auth] File exists: ${credsPath ? fs.existsSync(credsPath) : false}`);
console.log(`[Auth] Project = ${process.env.GOOGLE_CLOUD_PROJECT}, Location = ${process.env.GOOGLE_CLOUD_LOCATION}`);

const app = express();
app.use(cors());
app.use(express.json());

// Setup storage for video uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Keep original name but add timestamp to avoid collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend connected to AI Director orchestrator');

    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            console.log('received JSON command:', parsed.type);

            if (parsed.type === 'start_pipeline' && parsed.filename) {
                const videoPath = path.join(uploadDir, parsed.filename);
                let tactics: any = [];
                let script: any = [];

                // Step 1: Analyst
                try {
                    ws.send(JSON.stringify({ type: 'status', data: 'Initialising: The Analyst watching video...' }));
                    tactics = await runAnalyst(videoPath);
                    console.log('[Pipeline] Analyst complete:', JSON.stringify(tactics).slice(0, 200));
                } catch (e: any) {
                    console.error('[Pipeline] ANALYST FAILED:', e?.message || e, '\nStatus:', e?.status, '\nDetails:', JSON.stringify(e?.errorDetails || e?.errors || {}));
                    ws.send(JSON.stringify({ type: 'status', data: `Error in Analyst: ${e?.message || 'Unknown error'}` }));
                    return;
                }

                // Step 2: Commentator
                try {
                    ws.send(JSON.stringify({ type: 'status', data: `Initialising: The Commentator (${parsed.persona || 'excited_narrator'}) writing script...` }));
                    script = await runCommentator(tactics, parsed.persona);
                    console.log('[Pipeline] Commentator complete:', JSON.stringify(script).slice(0, 200));
                } catch (e: any) {
                    console.error('[Pipeline] COMMENTATOR FAILED:', e?.message || e, '\nStatus:', e?.status, '\nDetails:', JSON.stringify(e?.errorDetails || e?.errors || {}));
                    ws.send(JSON.stringify({ type: 'status', data: `Error in Commentator: ${e?.message || 'Unknown error'}` }));
                    return;
                }

                // Step 3: Director
                try {
                    ws.send(JSON.stringify({ type: 'status', data: 'Initialising: The Director taking control...' }));
                    await runDirector(videoPath, tactics, script, ws);
                } catch (e: any) {
                    console.error('[Pipeline] DIRECTOR FAILED:', e?.message || e, '\nStatus:', e?.status, '\nDetails:', JSON.stringify(e?.errorDetails || e?.errors || {}));
                    ws.send(JSON.stringify({ type: 'status', data: `Error in Director: ${e?.message || 'Unknown error'}` }));
                }
            }
        } catch (e) {
            console.log('received plain string:', message.toString());
        }
    });

    ws.send(JSON.stringify({ type: 'status', data: 'AI Director Sandbox Ready' }));
});

const PORT = process.env.PORT || 9090;

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'AI Director Orchestrator' });
});

// Endpoint to handle video uploads from the frontend
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }

    console.log(`Video uploaded for testing: ${req.file.filename}`);
    // In the future, this endpoint will trigger the Agent pipeline!

    res.json({
        message: 'Video uploaded successfully',
        filename: req.file.filename,
        path: req.file.path
    });
});

server.listen(PORT, () => {
    console.log(`AI Director Backend listening on port ${PORT}`);
});
