import { WebSocket } from 'ws';
import path from 'path';
import { cutClip } from '../utils/clipExtractor';

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
            startSec: number;
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
            const globalStartSec = localStartSec + chunkStartTimeSec;
            timeline.push({ tactic, commentary: item, startSec: globalStartSec });
        }

        // Sort strictly by video timestamp
        timeline.sort((a, b) => a.startSec - b.startSec);

        console.log(`[The Director] Timeline (${timeline.length} events):`,
            timeline.map(e => `${e.startSec}s → ${e.tactic.event}`).join(' | '));

        // ── Stream events to frontend ────────────────────────────────────────
        for (const entry of timeline) {
            const { tactic, commentary, startSec } = entry;

            // Support both old format (text) and new format (lines[])
            const lines: string[] = Array.isArray(commentary.lines)
                ? commentary.lines
                : (commentary.text ? [commentary.text] : []);

            const isHigh = commentary.importance === 'high' ||
                /goal|save|block|shot|strike|penalty/i.test(tactic.event ?? '');

            // ── Low-importance: one commentary + optional visual ──────────────
            if (!isHigh || lines.length === 0) {
                if (lines[0]) {
                    ws.send(JSON.stringify({
                        type: 'commentary',
                        data: lines[0],
                        videoTimestamp: startSec
                    }));
                }
                ws.send(JSON.stringify({
                    type: 'visual',
                    data: `Tracking: ${tactic.event}`,
                    videoTimestamp: startSec
                }));
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }

            // ── High-importance: buildup → clip → climax → reaction ──────────

            // Line 0: buildup — fires at the event's actual video timestamp
            if (lines[0]) {
                ws.send(JSON.stringify({
                    type: 'commentary',
                    data: lines[0],
                    videoTimestamp: startSec
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

            // VIDEO_CLIP fires at startSec — triggers the replay on frontend
            ws.send(JSON.stringify({
                type: 'video_clip',
                data: `Highlight: ${tactic.event}`,
                clipUrl: clipFilename ? `/clips/${clipFilename}` : undefined,
                videoTimestamp: startSec
            }));

            // Line 1 (climax) fires 2s into replay
            if (lines[1]) {
                ws.send(JSON.stringify({
                    type: 'commentary',
                    data: lines[1],
                    videoTimestamp: startSec + 2
                }));
            }

            // Line 2 (reaction) fires 5s into replay
            if (lines[2]) {
                ws.send(JSON.stringify({
                    type: 'commentary',
                    data: lines[2],
                    videoTimestamp: startSec + 5
                }));
            }

            // Small gap before next event
            await new Promise(r => setTimeout(r, 1000));
        }

        ws.send(JSON.stringify({ type: 'status', data: 'Agent Pipeline Complete' }));

    } catch (e) {
        console.error(`[The Director] Error:`, e);
        ws.send(JSON.stringify({ type: 'status', data: 'Error in Director Pipeline' }));
    }
}
