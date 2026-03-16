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

export type StorybookAsset = {
    title: string;
    narrative: string;
    imageUrl?: string; 
};

export async function runStoryteller(matchHistory: string): Promise<StorybookAsset | null> {
    const client = getAI();
    console.log(`[The Storyteller] Synthesizing full match recap...`);

    try {
        const prompt = `You are a legendary sports journalist writing a dramatic post-match recap.
I will give you the raw event log from the match.

Your job is to synthesize this raw log into a compelling, 3-paragraph "Storybook" narrative.
Capture the emotion, the turning points, and the final result.

Match Log:
${matchHistory}

Return a strict JSON object with these properties:
1. "title": A catchy, newspaper-style headline for the match.
2. "narrative": The 3-paragraph story. Use HTML <p> tags for paragraphs.
3. "imagePrompt": A highly detailed prompt for an AI image generator (Imagen) to create a dramatic illustration of the defining moment of this match. (e.g. "A dramatic, cinematic wide shot of a football stadium exploding in celebration as a player in green scores a volley, dramatic lighting, high quality")`;

        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [prompt],
            config: {
                // Force JSON output
                responseMimeType: "application/json",
                temperature: 0.8
            }
        });

        const rawText = response.text || "{}";
        let parsed: any;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            console.error(`[The Storyteller] Failed to parse JSON recap.`);
            return null;
        }

        console.log(`[The Storyteller] Storybook drafted: "${parsed.title}"`);

        // --- Generate Image via Imagen 3 ---
        let imageUrl: string | undefined = undefined;
        if (parsed.imagePrompt) {
            console.log(`[The Storyteller] Generating illustration: ${parsed.imagePrompt}`);
            try {
                const imageResponse = await client.models.generateImages({
                    model: 'imagen-3.0-generate-001',
                    prompt: parsed.imagePrompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: '16:9'
                    }
                });

                if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
                    const imageObj = imageResponse.generatedImages[0].image;
                    if (imageObj && imageObj.imageBytes) {
                        const base64Image = imageObj.imageBytes;
                        const filename = `storybook_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
                        const filepath = require('path').join(__dirname, '../../uploads/clips', filename);
                        require('fs').writeFileSync(filepath, Buffer.from(base64Image, 'base64'));
                        imageUrl = `http://localhost:9090/clips/${filename}`;
                    }
                }
            } catch (imageErr) {
                console.error(`[The Storyteller] Imagen generation failed:`, imageErr);
            }
        }

        return {
            title: parsed.title,
            narrative: parsed.narrative,
            imageUrl: imageUrl
        };

    } catch (error) {
        console.error(`[The Storyteller] Error during script generation:`, error);
        return null;
    }
}
