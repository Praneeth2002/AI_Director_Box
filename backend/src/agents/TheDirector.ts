import { WebSocket } from 'ws';
import path from 'path';
import { cutClip } from '../utils/clipExtractor';
import { uploadToGCS, getServeUrl } from '../utils/gcsStorage';

const clipsDir = path.join(__dirname, '../../uploads/clips');

// Parse "HH:MM:SS-HH:MM:SS" or "MM:SS-MM:SS" → start in seconds
function getStartSec(timestamp: string): number {
    const part = timestamp.split('-')[0].trim();
    const segs = part.split(':').map(Number);
    if (segs.length === 3) return segs[0] * 3600 + segs[1] * 60 + segs[2];
    if (segs.length === 2) return segs[0] * 60 + segs[1];
    return segs[0];
}

export async function runDirector(
    videoFilePath: string,
    tacticalData: any[],
    commentaryScript: any[],
    ws: WebSocket,
    chunkStartTimeSec: number = 0 // Offset for chunked real-time processing
) {
    console.log(`[The Director] Building timestamp-synced broadcast timeline (Offset: ${chunkStartTimeSec}s)...`);

    try {
        // ── Match each commentary item to its tactical event ────────────────
        type TimelineEntry = {
            tactic: any;
            commentary: any;
            exactEventSec: number;
            chunkStartSec: number; // Keep track of the chunk boundary to start speaking early
        };

        const timeline: TimelineEntry[] = [];

        for (const item of commentaryScript) {
            // Find the matching tactic by event name
            const tactic = tacticalData.find(t =>
                t.event === item.related_tactics ||
                (item.related_tactics || '').toLowerCase().includes((t.event || '').toLowerCase())
            ) ?? tacticalData[0];

            if (!tactic) continue;

            const localStartSec = getStartSec(tactic.timestamp ?? '0:00');
            const exactEventSec = localStartSec + chunkStartTimeSec;
            timeline.push({ tactic, commentary: item, exactEventSec, chunkStartSec: chunkStartTimeSec });
        }

        // Sort strictly by video timestamp
        timeline.sort((a, b) => a.exactEventSec - b.exactEventSec);

        console.log(`[The Director] Timeline (${timeline.length} events):`,
            timeline.map(e => `${e.exactEventSec}s → ${e.tactic.event}`).join(' | '));

        // ── Stream events to frontend ────────────────────────────────────────
        for (const entry of timeline) {
            const { tactic, commentary, exactEventSec, chunkStartSec } = entry;

            // Support both old format (text) and new format (lines array of objects)
            const lines = Array.isArray(commentary.lines)
                ? commentary.lines
                : (commentary.text ? [{ text: commentary.text }] : []);

            const isHigh = commentary.importance === 'high' ||
                /goal|save|block|shot|strike|penalty/i.test(tactic.event ?? '');

            // ── Low-importance: one commentary + optional visual ──────────────
            if (!isHigh || lines.length === 0) {
                if (lines[0]) {
                    ws.send(JSON.stringify({
                        type: 'commentary',
                        data: lines[0].text,
                        audioUrl: lines[0].audioUrl,
                        // Fire general commentary immediately at chunk start to prevent dead air
                        videoTimestamp: chunkStartSec 
                    }));
                }
                ws.send(JSON.stringify({
                    type: 'visual',
                    data: `Tracking: ${tactic.event}`,
                    mermaid: tactic.mermaid_diagram,
                    videoTimestamp: exactEventSec
                }));
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }

            // ── High-importance: buildup → clip → climax → reaction ──────────

            // Line 0: buildup — fire early at the start of the chunk to build anticipation
            if (lines[0]) {
                ws.send(JSON.stringify({
                    type: 'commentary',
                    data: lines[0].text,
                    audioUrl: lines[0].audioUrl,
                    videoTimestamp: chunkStartSec
                }));
            }

            // Line 1: Climax — fire at the EXACT MOMENT of the event on the LIVE feed
            // This prevents the 4-second gap of silence before the replay prompt
            if (lines[1]) {
                ws.send(JSON.stringify({
                    type: 'commentary',
                    data: lines[1].text,
                    audioUrl: lines[1].audioUrl,
                    videoTimestamp: exactEventSec
                }));
            }

            // Cut the clip
            let clipFilename: string | null = null;
            if (tactic.timestamp) {
                try {
                    clipFilename = await cutClip(videoFilePath, clipsDir, tactic.event, tactic.timestamp);
                } catch (clipErr) {
                    console.error('[The Director] Clip cut failed:', clipErr);
                }
            }

            // VIDEO_CLIP now fires 4s after exact event time — to ask the user "Want to see a replay?"
            // It bundles the climax (Line 1) and reaction (Line 2) to be played DURING the replay.
            let serveClipUrl = clipFilename ? `/clips/${clipFilename}` : undefined;
            if (clipFilename) {
                const clipPath = path.join(clipsDir, clipFilename);
                const gcsClipUrl = await uploadToGCS(clipPath, 'clips');
                serveClipUrl = getServeUrl(`/clips/${clipFilename}`, gcsClipUrl) ?? serveClipUrl;
            }

            ws.send(JSON.stringify({
                type: 'video_clip',
                data: `Highlight: ${tactic.event}`,
                clipUrl: serveClipUrl,
                videoTimestamp: exactEventSec + 4,
                replayCommentary: {
                    climax: lines[1] ? { text: lines[1].text, audioUrl: lines[1].audioUrl, delay: 2 } : undefined,
                    reaction: lines[2] ? { text: lines[2].text, audioUrl: lines[2].audioUrl, delay: 5 } : undefined
                }
            }));

            // Small gap before next event
            await new Promise(r => setTimeout(r, 1000));
        }

        ws.send(JSON.stringify({ type: 'status', data: 'Agent Pipeline Complete' }));

    } catch (e) {
        console.error(`[The Director] Error:`, e);
        ws.send(JSON.stringify({ type: 'status', data: 'Error in Director Pipeline' }));
    }
}
