import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

let ai: GoogleGenAI;

function getAI(): GoogleGenAI {
    if (!ai) {
        ai = new GoogleGenAI({ vertexai: true });
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

        const prompt = `You are an expert football tactical analyst. Watch this video clip.
Output a strict JSON array of tactical events that occur in the video.
Each object in the array MUST have exactly these three properties:
1. "timestamp": string (e.g., "00:00-00:05")
2. "event": string (A short title for the event, e.g., "High Press" or "Through Ball")
3. "tactics": string (A 1-2 sentence tactical breakdown of the player movement, formation, or play).

If nothing interesting happens, return a single event describing the general run of play.`;

        const response = await client.models.generateContent({
            model: 'gemini-1.5-pro',
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
