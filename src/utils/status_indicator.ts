export class StatusIndicator {
    private channel: 'telegram' | 'slack';
    private chatId: string;
    private userId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private bot: any;
    private messageId: string | number | null = null;
    private intervalId: NodeJS.Timeout | null = null;
    private stopped = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(channel: 'telegram' | 'slack', chatId: string, bot: any, userId?: string) {
        this.channel = channel;
        this.chatId = chatId;
        this.userId = userId;
        this.bot = bot;
    }

    async start(message?: string): Promise<void> {
        this.stopped = false;
        if (this.channel === 'telegram') {
            // Start typing interval
            const sendTyping = async () => {
                if (this.stopped) return;
                try {
                    await this.bot.sendChatAction(this.chatId, 'typing');
                } catch (err) {
                    console.warn('[StatusIndicator] Failed to send typing:', err);
                }
            };
            void sendTyping();
            this.intervalId = setInterval(sendTyping, 4000);

            if (message) {
                try {
                    const res = await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
                    this.messageId = res.message_id;
                } catch (err) {
                    console.warn('[StatusIndicator] Failed to send status message:', err);
                }
            }
        } else if (this.channel === 'slack') {
            if (message) {
                try {
                    // Use a normal message so we can reliably update/delete it while tools run.
                    const res = await this.bot.chat.postMessage({
                        channel: this.chatId,
                        text: message
                    });
                    this.messageId = res.ts;
                } catch (err) {
                    console.warn('[StatusIndicator] Failed to send slack status message:', err);
                }
            }
        }
    }

    async update(message: string): Promise<void> {
        if (this.stopped || !this.messageId) return;

        try {
            if (this.channel === 'telegram') {
                await this.bot.editMessageText(message, {
                    chat_id: this.chatId,
                    message_id: this.messageId as number,
                    parse_mode: 'Markdown'
                });
            } else if (this.channel === 'slack') {
                await this.bot.chat.update({
                    channel: this.chatId,
                    ts: String(this.messageId),
                    text: message
                });
            }
        } catch (err) {
            console.warn('[StatusIndicator] Failed to update status:', err);
        }
    }

    async stop(keepMessage = false): Promise<void> {
        this.stopped = true;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.messageId && !keepMessage) {
            try {
                if (this.channel === 'telegram') {
                    await this.bot.deleteMessage(this.chatId, this.messageId as number);
                } else if (this.channel === 'slack') {
                    await this.bot.chat.delete({
                        channel: this.chatId,
                        ts: String(this.messageId),
                    });
                }
            } catch (err) {
                console.warn('[StatusIndicator] Failed to delete status message:', err);
            }
            this.messageId = null;
        }
    }
}
