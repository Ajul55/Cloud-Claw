import { describe, expect, it } from 'vitest';
import { extractApprovedToolCall } from './resume.js';

describe('HITL resume helpers', () => {
    it('recovers the original tool call args from the saved assistant message', () => {
        const toolCall = extractApprovedToolCall([
            {
                role: 'assistant',
                tool_calls: [
                    {
                        id: 'call_123',
                        function: {
                            name: 'create_system_user',
                            arguments: JSON.stringify({
                                server_id: 'srv_1',
                                username: 'alice',
                                password: 'super-secret',
                            }),
                        },
                    },
                ],
            },
        ] as Array<Record<string, unknown>>, 'call_123');

        expect(toolCall).toEqual({
            toolName: 'create_system_user',
            args: {
                server_id: 'srv_1',
                username: 'alice',
                password: 'super-secret',
            },
        });
    });

    it('returns null when the tool call is not present in session history', () => {
        const toolCall = extractApprovedToolCall([
            {
                role: 'assistant',
                tool_calls: [
                    {
                        id: 'call_other',
                        function: {
                            name: 'create_system_user',
                            arguments: '{}',
                        },
                    },
                ],
            },
        ] as Array<Record<string, unknown>>, 'call_missing');

        expect(toolCall).toBeNull();
    });
});
