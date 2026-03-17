import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION });

async function run() {
    try {
        console.log("Generating image...");
        const response = await ai.models.generateImages({
            model: 'imagen-3.0-generate-001',
            prompt: 'A dramatic, cinematic wide shot of a football stadium exploding in celebration as a player in green scores a volley, dramatic lighting, high quality',
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '16:9'
            }
        });
        console.log("Success! Image generated.");
        if (response.generatedImages && response.generatedImages.length > 0) {
            console.dir(Object.keys(response.generatedImages[0].image));
        } else {
            console.log("No images were returned in the response.");
        }
    } catch (e) {
        console.error("Failed:", e);
    }
}
run();
