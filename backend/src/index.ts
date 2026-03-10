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
const clipsDir = path.join(__dirname, '../uploads/clips');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));
app.use('/clips', express.static(clipsDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// In-memory cache: filename → tactical analysis results
const tacticsCache = new Map<string, any>();

async function runAnalystPhase(filename: string, videoPath: string, ws: WebSocket) {
    ws.send(JSON.stringify({ type: 'status', data: '🔍 The Analyst is watching the video...' }));
    try {
        const tactics = await runAnalyst(videoPath);
        tacticsCache.set(filename, tactics);
        console.log(`[Pipeline] Analysis cached for ${filename}:`, JSON.stringify(tactics).slice(0, 200));
        ws.send(JSON.stringify({ type: 'analysis_complete', filename, eventCount: tactics.length }));
    } catch (e: any) {
        console.error('[Pipeline] ANALYST FAILED:', e?.message || e);
        ws.send(JSON.stringify({ type: 'status', data: `❌ Analyst error: ${e?.message || 'Unknown error'}` }));
    }
}

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend connected to AI Director orchestrator');

    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            console.log('received JSON command:', parsed.type);

            // Phase 1: triggered immediately on upload — run TheAnalyst only
            if (parsed.type === 'start_analysis' && parsed.filename) {
                const videoPath = path.join(uploadDir, parsed.filename);
                runAnalystPhase(parsed.filename, videoPath, ws); // fire-and-forget
                return;
            }

            // Phase 2: triggered when user picks persona and clicks "Generate Commentary"
            // Skips TheAnalyst — uses cached tactics
            if (parsed.type === 'start_pipeline' && parsed.filename) {
                const tactics = tacticsCache.get(parsed.filename);

                if (!tactics) {
                    ws.send(JSON.stringify({ type: 'status', data: '⚠️ Analysis not ready yet, please wait...' }));
                    return;
                }

                const videoPath = path.join(uploadDir, parsed.filename);
                let script: any = [];

                // Step 2: Commentator
                try {
                    ws.send(JSON.stringify({ type: 'status', data: `🎙️ Writing script as ${parsed.persona || 'excited_narrator'}...` }));
                    script = await runCommentator(tactics, parsed.persona);
                    console.log('[Pipeline] Commentator complete:', JSON.stringify(script).slice(0, 200));
                } catch (e: any) {
                    console.error('[Pipeline] COMMENTATOR FAILED:', e?.message || e);
                    ws.send(JSON.stringify({ type: 'status', data: `❌ Commentator error: ${e?.message || 'Unknown error'}` }));
                    return;
                }

                // Step 3: Director — streams output line by line to the client
                try {
                    ws.send(JSON.stringify({ type: 'status', data: '🎬 The Director is taking control...' }));
                    await runDirector(videoPath, tactics, script, ws);
                } catch (e: any) {
                    console.error('[Pipeline] DIRECTOR FAILED:', e?.message || e);
                    ws.send(JSON.stringify({ type: 'status', data: `❌ Director error: ${e?.message || 'Unknown error'}` }));
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

app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }
    console.log(`Video uploaded: ${req.file.filename}`);
    res.json({
        message: 'Video uploaded successfully',
        filename: req.file.filename,
        path: req.file.path
    });
});

server.listen(PORT, () => {
    console.log(`AI Director Backend listening on port ${PORT}`);
});
