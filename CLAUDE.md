# Developer Guide (CLAUDE.md)

This guide outlines the build, test, and code conventions for the **Luminate AI** repository.

## Commands

### 1. Build and Development
* Start the dev server: `npm run dev`
* Standard build: `npm run build`
* GitHub Pages build (with GITHUB_PAGES basePath): `npm run build:gh-pages`
* Run linting: `npm run lint`

### 2. Scripts and Indexing
* Build RAG Search Index: `npx tsx scripts/build-index.ts`
* Run Evaluation Benchmarks: `npx tsx scripts/eval.ts`
* Test Search Match Heuristics: `npx tsx scripts/test-match.ts`

### 3. Deployments
* Force deploy static build to GitHub Pages:
  ```bash
  npm run build:gh-pages
  cd out
  git init && git checkout -b gh-pages
  git remote add origin https://github.com/Jyotiraditya21-bug/LuminateAI.git
  git add . && git commit -m "Deploy update"
  git push -f origin gh-pages
  ```

## Code Guidelines & Standards

### 1. Technology Stack
* **Framework**: Next.js 16 (Turbopack, App Router).
* **Styling**: Vanilla CSS (`src/app/globals.css`). Keep layout clean, modern, and editorial.
* **Serverless Architecture**: All core logic (vector retrieval, context grading, arXiv API requests, and LLM calls) must run **client-side in the browser** in `src/app/page.tsx`.

### 2. Model References
* **Groq**: Use `llama-3.1-8b-instant` (do not use `llama3-8b-8192` as it is deprecated).
* **Gemini**: Use `gemini-2.5-flash` (do not use `gemini-1.5-flash` as it is deprecated).
* **OpenAI**: Use `gpt-4o-mini` for similarity embeddings and baseline calls.

### 3. State & Key Security
* Never commit secrets or API keys to Git.
* Save and load API keys directly to/from `localStorage` inside client components.
* Ensure offline mode works without keys using static evaluation results located in `public/eval-results.json`.
