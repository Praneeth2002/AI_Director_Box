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



import { getVideoDuration, extractChunk } from './utils/clipExtractor';

// Default chunk duration is 15 seconds unless overridden in .env
const CHUNK_DURATION_SECONDS = parseInt(process.env.CHUNK_DURATION_SECONDS || '15', 10);

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend connected to AI Director orchestrator');

    // To gracefully stop processing if the user disconnects or starts a new video
    let activeStreamId: string | null = null;

    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            console.log('received JSON command:', parsed.type);

            // Phase 1: start_pipeline (triggered when user picks persona and clicks "Generate")
            // This now handles both analysis and commentary in real-time chunks
            if (parsed.type === 'start_pipeline' && parsed.filename) {
                const streamId = Math.random().toString(36).substring(7);
                activeStreamId = streamId;

                const videoPath = path.join(uploadDir, parsed.filename);
                const persona = parsed.persona || 'excited_narrator';

                try {
                    // 1. Get total duration
                    ws.send(JSON.stringify({ type: 'status', data: '🎬 Measuring video length...' }));
                    const durationSec = await getVideoDuration(videoPath);
                    console.log(`[Pipeline] Video duration: ${durationSec}s. Chunks: ~${Math.ceil(durationSec / CHUNK_DURATION_SECONDS)}`);

                    ws.send(JSON.stringify({ type: 'status', data: '🔴 LIVE BROADCASING STARTED' }));

                    let currentStartSec = 0;
                    let chunkIndex = 0;

                    // 2. Loop through the video in chunks
                    while (currentStartSec < durationSec && activeStreamId === streamId) {
                        const remaining = durationSec - currentStartSec;
                        const chunkDuration = Math.min(CHUNK_DURATION_SECONDS, remaining);

                        console.log(`\n======================================================`);
                        console.log(`🎬 STARTING CHUNK ${chunkIndex} (${currentStartSec}s to ${currentStartSec + chunkDuration}s)`);
                        console.log(`======================================================\n`);

                        // Extract the chunk
                        const chunkFilename = await extractChunk(videoPath, clipsDir, currentStartSec, chunkDuration, chunkIndex);
                        const chunkPath = path.join(clipsDir, chunkFilename);

                        // Step 1: The Analyst (detects tactics in this chunk)
                        const tactics = await runAnalyst(chunkPath);
                        console.log(`[Pipeline] Chunk ${chunkIndex} analysis complete. Events: ${tactics.length}`);

                        if (tactics.length > 0) {
                            // Step 2: The Commentator (writes script for this chunk)
                            const script = await runCommentator(tactics, persona);
                            console.log(`[Pipeline] Chunk ${chunkIndex} script generated.`);

                            // Step 3: The Director (streams the timeline, offset by currentStartSec)
                            await runDirector(videoPath, tactics, script, ws, currentStartSec);
                        }

                        // Cleanup the temporary chunk file to save space
                        fs.unlink(chunkPath, (err) => {
                            if (err) console.error(`[Cleanup] Failed to delete chunk ${chunkFilename}:`, err.message);
                        });

                        // Move to next chunk
                        currentStartSec += chunkDuration;
                        chunkIndex++;
                    }

                    if (activeStreamId === streamId) {
                        ws.send(JSON.stringify({ type: 'status', data: '✅ Broadcast Complete' }));
                        console.log('[Pipeline] Finished all chunks.');
                    }

                } catch (e: any) {
                    console.error('[Pipeline] PIPELINE FAILED:', e?.message || e);
                    ws.send(JSON.stringify({ type: 'status', data: `❌ Error: ${e?.message || 'Unknown error'}` }));
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
