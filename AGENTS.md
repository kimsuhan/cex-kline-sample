# Repository Guidelines

## Project Structure & Module Organization
- `src/app/`: Primary Next.js route structure; keep feature logic in co-located folders (e.g., `market/page.tsx`, `market/hooks.ts`) and share utilities via `src/app/lib/` if they grow.
- `src/app/globals.css`: Global design tokens; prefer component-scoped CSS Modules for new styles.
- `public/`: Static assets served from the root; name files with kebab-case and version query strings when replacing.
- Root configs (`next.config.ts`, `eslint.config.mjs`, `tsconfig.json`) should stay lightweight—extend rather than replace shared rules.

## Build, Test, and Development Commands
- `npm run dev`: Starts the Next.js dev server with hot reload; use when iterating on UI or API routes.
- `npm run build`: Produces the production bundle; run before publishing major changes to catch build-time failures.
- `npm run start`: Serves the built app locally to verify production behavior.
- `npm run lint`: Executes ESLint with the Next.js config; fix or silence warnings before opening a PR.

## Coding Style & Naming Conventions
- Stick to TypeScript and React 19 features; prefer function components with hooks over class components.
- Use PascalCase for React components and hooks (`usePriceFeed`), camelCase for helpers, and UPPER_SNAKE for constants.
- Follow the project ESLint recommendations; autofix with `npm run lint -- --fix` and avoid disabling rules unless justified in the PR.
- Keep modules focused: export a single default component per route folder and move shared logic into `src/app/lib/`.

## Testing Guidelines
- Automated testing is not yet configured; when adding coverage, co-locate specs in `__tests__` folders and document new scripts in `package.json`.
- Validate GraphQL integrations against the target endpoint using schema mocks before merging.
- Perform manual smoke tests via `npm run start` for critical flows (initial render, live data updates) until automated suites land.

## Commit & Pull Request Guidelines
- Write imperative, concise commit subjects (`Add candlestick adapter`); keep body wrapped at ~72 characters when detail is needed.
- Reference related issues in the body (`Refs #123`) and describe notable UI changes.
- Pull requests should summarize scope, list testing performed, and include screenshots or screen recordings for UI-facing updates.
- Request review once linting passes and the branch syncs with `main`.
