let consecutiveFailures = 0;

export function recordLlmSuccess(): void {
    consecutiveFailures = 0;
}

export function recordLlmFailure(): void {
    consecutiveFailures++;
}

export function getConsecutiveLlmFailures(): number {
    return consecutiveFailures;
}
