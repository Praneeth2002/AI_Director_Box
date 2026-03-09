import { GoogleGenAI } from '@google/genai';
import { WebSocket } from 'ws';

let ai: GoogleGenAI;

function getAI(): GoogleGenAI {
    if (!ai) {
        ai = new GoogleGenAI({ vertexai: true });
    }
    return ai;
}


export async function runDirector(videoFilePath: string, tacticalData: any, commentaryScript: any, ws: WebSocket) {
    const client = getAI();
    console.log(`[The Director] Stitching the final Match Story together...`);

    try {
        const prompt = `You are "The Director" of a live football broadcast. 
You are responsible for weaving together raw tactical data and a pre-written commentary script into a single, cohesive timeline.

Input Data:
1. Tactics JSON: ${JSON.stringify(tacticalData)}
2. Commentary Script JSON: ${JSON.stringify(commentaryScript)}

Task:
Generate a chronological timeline of the match using ONLY the exact strings provided below to trigger frontend events.
You MUST interleave commentary texts with visual overlays. Do not invent new commentary.

Available String Formats (You must use exactly these prefixes):
[COMMENTARY] <exact text from script>
[VISUAL] <a short description of an overlay to show, e.g. "Showing 4-3-3 Formation">
[VIDEO_CLIP] <a short title for a highlight clip>

Output Example:
[VISUAL] Displaying Player Focus Card: Midfielder interception
[COMMENTARY] <tone:excited> What a tackle!
[VIDEO_CLIP] Highlight: Midfield Turn-over`;

        // Note: For true interleaved streaming, we'd use generateContentStream
        // To keep this local mock simple and robust, we generate it all and then mock the stream 
        // to the client to simulate the experience.
        const response = await client.models.generateContent({
            model: 'gemini-1.5-pro',
            contents: [prompt],
            config: {
                temperature: 0.2
            }
        });

        const storyLines = response.text ? response.text.split('\n').filter(l => l.trim().length > 0) : [];
        console.log(`[The Director] Generated Sequence:\n`, storyLines.join('\n'));

        // Simulate streaming the output to the UI with slight delays
        for (let i = 0; i < storyLines.length; i++) {
            const line = storyLines[i].trim();

            // Artificial delay to make it feel like a live stream
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (line.startsWith('[COMMENTARY]')) {
                ws.send(JSON.stringify({ type: 'commentary', data: line.replace('[COMMENTARY]', '').trim() }));
            } else if (line.startsWith('[VISUAL]')) {
                ws.send(JSON.stringify({ type: 'visual', data: line.replace('[VISUAL]', '').trim() }));
            } else if (line.startsWith('[VIDEO_CLIP]')) {
                ws.send(JSON.stringify({ type: 'video_clip', data: line.replace('[VIDEO_CLIP]', '').trim() }));
            }
        }

        ws.send(JSON.stringify({ type: 'status', data: 'Agent Pipeline Complete' }));

    } catch (e) {
        console.error(`[The Director] Error:`, e);
        ws.send(JSON.stringify({ type: 'status', data: 'Error in Director Pipeline' }));
    }
}
