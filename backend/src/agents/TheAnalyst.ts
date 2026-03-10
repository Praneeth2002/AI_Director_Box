import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

let ai: GoogleGenAI;

function getAI(): GoogleGenAI {
    if (!ai) {
        ai = new GoogleGenAI({
            vertexai: true,
            project: process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GOOGLE_CLOUD_LOCATION
        });
    }
    return ai;
}

export async function runAnalyst(videoFilePath: string) {
    const client = getAI();
    console.log(`[The Analyst] Processing video: ${videoFilePath}`);

    try {
        // Read the video file and encode as base64 for inline API calls
        console.log(`[The Analyst] Reading video file...`);
        const videoBytes = fs.readFileSync(videoFilePath);
        const base64Video = videoBytes.toString('base64');
        const ext = path.extname(videoFilePath).toLowerCase();
        const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : 'video/mp4';
        const fileSizeMB = (videoBytes.length / (1024 * 1024)).toFixed(2);
        console.log(`[The Analyst] Video loaded (${fileSizeMB} MB). Sending to Gemini Vision...`);

        const prompt = `You are an expert football broadcast analyst. Watch this entire video clip carefully.

Output a strict JSON array covering EVERY significant moment — both tactical AND atmosphere/broadcast moments.

Event categories to detect and include:
- TACTICAL: goals, shots, saves, tackles, fouls, corners, through balls, pressing, formations
- ATMOSPHERE: crowd celebrations, fan reactions, player celebrations after a goal, team huddles, emotional moments, post-goal atmosphere
- TRANSITIONS: kick-off, referee decisions, end of play

Each object MUST have exactly these properties:
1. "timestamp": string — start-end time (e.g., "0:00:02-0:00:05")
2. "event": string — short descriptive title (e.g., "Penalty Goal", "Crowd Celebration", "Player Huddle")
3. "tactics": string — 1-2 sentences describing what is visually happening and why it matters

CRITICAL: Do NOT skip the end of the video. If fans are celebrating or players are reacting after a goal, that is a separate event with its own timestamp.
If nothing significant happens in a segment, describe the general run of play.`;

        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Video,
                            }
                        },
                        { text: prompt }
                    ]
                }
            ],
            config: {
                responseMimeType: 'application/json',
            }
        });

        const rawText = response.text || '[]';
        console.log(`[The Analyst] Raw Output:\n`, rawText);

        let parsedJSON = [];
        try {
            parsedJSON = JSON.parse(rawText);
        } catch (e) {
            console.error(`[The Analyst] Failed to parse JSON, using fallback.`);
            parsedJSON = [{ timestamp: "00:00", event: "Parsing Error", tactics: rawText }];
        }

        return parsedJSON;

    } catch (error) {
        console.error(`[The Analyst] Error during analysis:`, error);
        return [
            { timestamp: "Error", event: "API Failure", tactics: "The Analyst encountered an error processing the video." }
        ];
    }
}
