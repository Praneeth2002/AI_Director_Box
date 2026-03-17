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

export async function runAnalyst(videoFilePath: string, pastContext: string = "") {
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

        const prompt = `You are an expert football broadcast analyst. Watch this short 10-15 second video chunk which is a segment of a larger live match.

${pastContext ? `PREVIOUS CHUNK CONTEXT (DO NOT RE-REPORT THESE EVENTS):\n${pastContext}\n\n` : ''}Output a strict JSON array covering ONLY the most significant, distinct moments in this chunk.

CRITICAL INSTRUCTIONS TO PREVENT SPAM/OVER-REPORTING:
1. DO NOT slice a single continuous sequence into multiple events. If a player scores, celebrates, and the crowd cheers, that is ONE single "Goal and Celebration" event, NOT three separate events.
2. A single chunk should rarely contain more than 1 or 2 events total.
3. If the chunk is just players passing around the back passing with nothing significant happening, return an empty array [].
4. Group related simultaneous actions together into a single summary event.
5. EXTREMELY IMPORTANT: If you see players celebrating, check the PREVIOUS CHUNK CONTEXT. If a goal was already reported, DO NOT report a new goal or new celebration. Return an empty array [], as the celebration is just ongoing.

Event categories to detect and include:
- TACTICAL: goals, shots, saves, tackles, fouls, corners
- ATMOSPHERE: crowd celebrating, post-goal atmosphere (grouped with the goal if possible)

Each object MUST have exactly these properties:
1. "timestamp": string — start-end time (e.g., "0:00:02-0:00:05")
2. "event": string — short descriptive title (e.g., "Penalty Goal", "Crowd Celebration")
3. "tactics": string — 1-2 sentences describing what is visually happening and why it matters
4. "mermaid_diagram": string (OPTIONAL) — If this is a highly tactical event (like a goal buildup, a formation shift, or a shot on target), provide a valid Mermaid.js syntax string representing the play. Use a "graph TD" or "sequenceDiagram". For example, showing Player A passing to Player B who shoots. Omit this field if it's just crowd atmosphere.

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
