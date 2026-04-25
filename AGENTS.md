# Repository Guidelines

## Project Structure & Module Organization

Cloud-Claw is a TypeScript Node.js AIOps agent. Core source lives in `src/`. The main entrypoint is `src/index.ts`; the agent loop is in `src/agents/loop.ts`; Slack, Telegram, and Cloudstick HTTP/SSE interfaces live in `src/interfaces/`. Tools are registered in `src/tools/tool_registry.ts`, with Cloudstick API tools under `src/tools/cloudstick/`. HITL approval logic is in `src/hitl/`, database access and schema are in `src/database/`, and security filters are in `src/security/`. The dashboard frontend is a separate Vite app in `dashboard/`. Tests are colocated as `*.test.ts` under `src/`.

## Build, Test, and Development Commands

- `npm run dev` starts the TypeScript app with `tsx watch`.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs Vitest against source tests via `vitest run --dir src`.
- `npm run build` compiles backend TypeScript to `dist/`.
- `npm run build:dashboard` builds the Vite dashboard.
- `npm run start` builds dashboard and backend, then runs `dist/src/index.js`.
- `npm run db:init` applies `src/database/schema.sql` to `$DATABASE_URL`.

## Coding Style & Naming Conventions

Use TypeScript ES modules and keep imports explicit with `.js` runtime suffixes. Follow the existing 4-space indentation style. Use `camelCase` for variables/functions, `PascalCase` for interfaces/classes, and snake_case only where matching tool names, DB columns, or external API fields. Keep tool modules self-contained and register every callable tool in `tool_registry.ts`.

## Testing Guidelines

Vitest is the test framework. Add tests beside the module being changed using `*.test.ts`. Security, HITL, gateway, command filtering, and loop behavior should have focused tests because regressions there can execute real server actions. Run `npm run typecheck` and `npm test` before handing off changes.

## Commit & Pull Request Guidelines

History uses Conventional Commit style, for example `feat: ...`, `fix: ...`, `docs: ...`, and scoped forms like `docs(dashboard): ...`. Keep commits focused and describe behavior, not just files changed. PRs should include a concise summary, test results, linked issue or task when available, and screenshots only for dashboard/UI changes.

## Security & Configuration Tips

Never commit `.env`, private keys, or Cloudstick credentials. Gateway requests use HMAC signing with `CLOUDSTICK_GATEWAY_KEY`; do not reintroduce raw bearer-key auth. Write operations must remain behind HITL approval. SSH commands must pass through the command filter, and new write tools need explicit approval metadata. PM2 is intentionally single-worker until the in-memory SSE bus is replaced by Redis/RabbitMQ.
