import { GoogleGenAI } from '@google/genai';

let ai: GoogleGenAI;

function getAI(): GoogleGenAI {
    if (!ai) {
        ai = new GoogleGenAI({ vertexai: true });
    }
    return ai;
}


export async function runCommentator(tacticalData: any, persona: string = "excited_narrator") {
    const client = getAI();
    console.log(`[The Commentator] Generating scripts based on tactical data using persona: ${persona}`);

    try {
        const prompt = `You are a sports commentator acting in the persona of a: ${persona}.
I will provide you with a JSON array of tactical events extracted from a football video clip.

For each event in the JSON, you MUST write exactly one line of commentary.
Your commentary must sound exactly like the requested persona.
You MUST prefix each line with an emotional tone tag that fits the moment. (Valid tags: <tone:excited>, <tone:calm>, <tone:anticipation>, <tone:disappointed>, <tone:funny>, <tone:analytical>)

Input Tactical Events JSON:
${JSON.stringify(tacticalData, null, 2)}

Output Format Requirements: 
Return a strict JSON array where each object has two properties:
1. "text": Your generated commentary string (including the <tone> prefix).
2. "related_tactics": The exact "event" name from the input JSON you are reacting to.`;

        const response = await client.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [prompt],
            config: {
                // Force JSON output
                responseMimeType: "application/json",
                temperature: 0.9 // Higher temperature for more creative commentary
            }
        });

        const rawText = response.text || "[]";
        console.log(`[The Commentator] Generated Script:\n`, rawText);

        try {
            return JSON.parse(rawText);
        } catch (e) {
            console.error(`[The Commentator] Failed to parse JSON script.`);
            return [];
        }

    } catch (error) {
        console.error(`[The Commentator] Error during script generation:`, error);
        return [
            { text: "<tone:disappointed> Apologies, we seem to have lost connection to the commentary box.", related_tactics: "Error" }
        ];
    }
}
