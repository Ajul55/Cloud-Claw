import OpenAI, { toFile } from 'openai';
import { env } from '../config/env.js';

// Transcriptions always use OpenAI's API regardless of the LLM provider selected
// because most other providers don't natively support whisper-1 or do it differently.
// Using the default LLM_API_KEY. If the user uses Anthropic, they should ensure
// they also set an OpenAI key if they want voice transcription, or we might need a dedicated key.
// But the spec says: "using OpenAI Whisper API (whisper-1)" so we assume LLM_API_KEY
// is an OpenAI key OR they have OPENAI_API_KEY. We will fall back to OPENAI_API_KEY if LLM_API_KEY is not OpenAI.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || env.LLM_API_KEY,
});

export async function transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
    try {
        const file = await toFile(buffer, filename);
        const response = await openai.audio.transcriptions.create({
            file: file,
            model: 'whisper-1'
        });
        return response.text;
    } catch (err) {
        console.error('[Transcriber] Whisper API error:', err);
        throw new Error('Voice transcription failed.');
    }
}
