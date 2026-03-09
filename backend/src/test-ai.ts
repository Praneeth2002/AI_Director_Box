import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenAI } from '@google/genai';

async function run() {
    try {
        console.log("Initializing AI...");
        const ai = new GoogleGenAI({
            vertexai: {
                project: process.env.GOOGLE_CLOUD_PROJECT,
                location: process.env.GOOGLE_CLOUD_LOCATION
            }
        });
        console.log("AI initialized.");
    } catch (e) {
        console.error("Error:", e);
    }
}
run();
