import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

// Resolve the ffmpeg binary — first try PATH, then fall back to the winget install location
function resolveFfmpegPath(): string | null {
    // Winget default install location on Windows
    const wingetPath = path.join(
        process.env.LOCALAPPDATA || '',
        'Microsoft', 'WinGet', 'Packages',
        'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'ffmpeg-8.0.1-full_build', 'bin', 'ffmpeg.exe'
    );
    if (fs.existsSync(wingetPath)) return wingetPath;
    return null; // let fluent-ffmpeg try PATH
}

const ffmpegBin = resolveFfmpegPath();
if (ffmpegBin) {
    console.log(`[Clip] Using ffmpeg at: ${ffmpegBin}`);
    ffmpeg.setFfmpegPath(ffmpegBin);
    // Use ffprobe from the same bin directory if available
    const ffprobeBin = path.join(path.dirname(ffmpegBin), 'ffprobe.exe');
    if (fs.existsSync(ffprobeBin)) {
        ffmpeg.setFfprobePath(ffprobeBin);
    }
} else {
    console.log('[Clip] ffmpeg not found at winget location, relying on system PATH');
}

// Get the total duration of a video file in seconds
export function getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                console.error('[Clip] ffprobe error:', err.message);
                return reject(err);
            }
            const duration = metadata.format.duration;
            resolve(duration ? parseFloat(duration.toString()) : 0);
        });
    });
}

// Parse "MM:SS-MM:SS" or "HH:MM:SS-HH:MM:SS" into start seconds + duration with ±1s buffer
export function parseTimestamp(ts: string): { start: number; duration: number } {
    const parts = ts.split('-').map(s => s.trim());
    const toSecs = (s: string): number => {
        const segs = s.split(':').map(Number);
        if (segs.length === 3) return segs[0] * 3600 + segs[1] * 60 + segs[2];
        if (segs.length === 2) return segs[0] * 60 + segs[1];
        return segs[0];
    };
    const rawStart = toSecs(parts[0]);
    const rawEnd = toSecs(parts[1] ?? parts[0]);
    const prePadding = parseInt(process.env.CLIP_PRE_PADDING_SECONDS || '3', 10);
    const postPadding = parseInt(process.env.CLIP_POST_PADDING_SECONDS || '3', 10);

    const start = Math.max(0, rawStart - prePadding);
    const end = rawEnd + postPadding;
    return { start, duration: Math.max(end - start, prePadding + postPadding) };
}

// Fuzzy-match a clip title like "Highlight: Penalty Goal" against tactic event names
export function findTacticTimestamp(clipTitle: string, tacticalData: any[]): string | null {
    const title = clipTitle.toLowerCase();
    const match = tacticalData.find(t => {
        const ev = (t.event || '').toLowerCase();
        return title.includes(ev) || ev.includes(title.split(':').pop()?.trim() ?? '');
    });
    return match?.timestamp ?? tacticalData[0]?.timestamp ?? null;
}

// Cut a short clip from videoPath and save it to clipsDir. Returns the saved filename.
// Uses -c copy (stream copy, no re-encode) for near-instant extraction.
export function cutClip(
    videoPath: string,
    clipsDir: string,
    eventName: string,
    timestamp: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

        const { start, duration } = parseTimestamp(timestamp);
        const safeName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
        const filename = `clip_${safeName}_${Date.now()}.mp4`;
        const outputPath = path.join(clipsDir, filename);

        console.log(`[Clip] Cutting: start=${start}s duration=${duration}s → ${filename}`);

        ffmpeg(videoPath)
            .setStartTime(start)
            .setDuration(duration)
            .outputOptions('-c copy')   // stream copy — no re-encode, very fast
            .output(outputPath)
            .on('end', () => {
                console.log(`[Clip] ✅ Saved: ${filename}`);
                resolve(filename);
            })
            .on('error', (err) => {
                console.error('[Clip] ❌ ffmpeg error:', err.message);
                reject(err);
            })
            .run();
    });
}

// Extract a specific time chunk from the video. Returns the saved filename.
// Removes -c copy to force re-encoding, guaranteeing millisecond-accurate slicing 
// (avoiding keyframe snapping) so we don't accidentally analyse the same clip twice.
export function extractChunk(
    videoPath: string,
    chunksDir: string,
    startTime: number,
    duration: number,
    chunkIndex: number
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

        const filename = `chunk_${chunkIndex}_${startTime}s.mp4`;
        const outputPath = path.join(chunksDir, filename);

        console.log(`[Chunk] Extracting ${duration}s from ${startTime}s → ${filename}`);

        ffmpeg(videoPath)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions(['-preset ultrafast', '-threads 2'])
            .output(outputPath)
            .on('end', () => {
                resolve(filename);
            })
            .on('error', (err) => {
                console.error(`[Chunk ${chunkIndex}] ❌ ffmpeg error:`, err.message);
                reject(err);
            })
            .run();
    });
}
