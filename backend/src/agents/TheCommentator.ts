import { GoogleGenAI } from '@google/genai';

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


export async function runCommentator(tacticalData: any, persona: string = "excited_narrator", pastContext: string = "") {
    const client = getAI();
    console.log(`[The Commentator] Generating scripts based on tactical data using persona: ${persona}`);

    try {
        const prompt = `You are a live sports commentator with the persona of: ${persona}.
I will give you a JSON array of tactical events from a football video clip.

${pastContext ? `PREVIOUS CHUNK CONTEXT TO AVOID REPETITION:\n${pastContext}\n\n` : ''}Your job is to write commentary for each event. The LENGTH of commentary depends on the event's importance:

HIGH IMPORTANCE events (containing keywords: goal, penalty, save, block, strike, shot):
  - Write a NARRATIVE ARC of exactly 3 commentary lines:
    1. BUILDUP line: Set the context — who was involved, what was about to happen (~15 words)
    2. CLIMAX line: The key moment itself — explosive, emotional, vivid (~8 words max)  
    3. REACTION line: Aftermath — crowd, implications, analysis (~15 words)
  - Use progressively intense tone tags: <tone:anticipation> → <tone:excited> → <tone:analytical>

LOW IMPORTANCE events (passing, formation, pressing, possession, transition):
  - Write exactly 1 commentary line (~12 words)
  - Use an appropriate tone tag

Persona rules:
  - Every line MUST sound exactly like the requested persona: ${persona}
  - For "tactical_nerd" or "analytical" styles, use measured language; for "excited_narrator", use exclamations; for "brazilian_narrator", use Portuguese flair.

Valid tone tags: <tone:excited>, <tone:calm>, <tone:anticipation>, <tone:disappointed>, <tone:funny>, <tone:analytical>

Input Tactical Events JSON:
${JSON.stringify(tacticalData, null, 2)}

Output Format Requirements:
Return a strict JSON array. Each object MUST have:
1. "lines": string[] — array of commentary strings (3 items for high-importance, 1 item for low-importance). Each string includes its <tone:*> prefix.
2. "related_tactics": the exact "event" name from the input JSON.
3. "importance": "high" or "low"

Example output:
[
  {
    "lines": [
      "<tone:anticipation> The striker receives it with her back to goal, spins brilliantly past two defenders.",
      "<tone:excited> GOAL! Top corner! Absolute rocket!",
      "<tone:analytical> That's clinical finishing — she gave the keeper absolutely no chance whatsoever."
    ],
    "related_tactics": "Goal Attempt",
    "importance": "high"
  }
]`;

        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
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
