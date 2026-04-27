import OpenAI from 'openai';

// ─── LLM response helpers ─────────────────────────────────────────────────────

function summarizeLLMResponse(response: unknown): string {
    if (response === null || response === undefined) {
        return String(response);
    }

    if (typeof response !== 'object') {
        return String(response);
    }

    try {
        const record = response as Record<string, unknown>;
        return JSON.stringify({
            id: record.id,
            object: record.object,
            model: record.model,
            choices: Array.isArray(record.choices) ? record.choices.length : record.choices,
            error: record.error ?? null,
        }).slice(0, 300);
    } catch {
        return '[unserializable response object]';
    }
}

export function extractCompletionChoice(response: unknown): OpenAI.ChatCompletion.Choice {
    const choices = (response as { choices?: OpenAI.ChatCompletion.Choice[] } | null | undefined)?.choices;
    const choice = Array.isArray(choices) ? choices[0] : undefined;

    if (!choice) {
        throw new Error(
            `LLM returned no choices. Provider payload preview: ${summarizeLLMResponse(response)}`,
        );
    }

    return choice;
}
