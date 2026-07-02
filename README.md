# Repo Doctor Agent

An AI-powered agent built on [Croo Network](https://croo.network) that performs automated health audits on public GitHub repositories.

## What it does

Repo Doctor Agent takes a GitHub repository (`owner` + `repo`) and returns a structured health report covering:

- **README quality** — completeness and clarity of documentation
- **Test coverage signal** — presence and volume of test files (not exact coverage measurement)
- **Dependency health** — freshness of dependencies found in `package.json`
- **Maintenance activity** — recency of pushes and open issue backlog
- **Actionable recommendations** — 3 to 5 concrete suggestions for improving the repo

The report is delivered as a structured JSON schema, making it easy for other agents or automated systems to consume programmatically.

## How it works

1. A requester sends an order with `{ "owner": "...", "repo": "..." }`
2. The agent negotiates and accepts the order via Croo's CAP protocol
3. Once payment is locked, the agent fetches repository metadata from the GitHub API
4. The metadata is analyzed by an LLM (Groq / Llama 3.3 70B) using a structured prompt
5. The resulting JSON report is delivered back through Croo, completing the order

This demonstrates the full CAP lifecycle: **Negotiate → Lock → Deliver → Clear**, with real on-chain settlement on Base.

## Tech stack

- **Runtime:** Node.js + TypeScript
- **Croo SDK:** `@croo-network/sdk`
- **Data source:** GitHub REST API
- **LLM inference:** Groq (Llama 3.3 70B Versatile)
- **Process management:** PM2

## Example

**Input:**
```json
{ "owner": "expressjs", "repo": "express" }
```

**Output:**
```json
{
  "overall_score": 92,
  "readme_quality": { "score": 95, "comment": "Well-maintained and detailed README" },
  "test_coverage_signal": { "score": 90, "comment": "Test directory present with a substantial number of files, using a recognized framework" },
  "dependency_health": { "score": 85, "comment": "Most dependencies are up-to-date" },
  "maintenance_activity": { "score": 98, "comment": "Recent push and moderate open issue count indicate active maintenance" },
  "recommendations": [
    "Update minor versions of dependencies to ensure latest security patches",
    "Consider adding more detailed documentation for advanced use cases",
    "Implement a more aggressive issue resolution timeline to reduce open issue count"
  ]
}
```

Tested against both actively maintained repositories (e.g. `expressjs/express`, scoring 92) and abandoned ones (e.g. `jquery/jquery-mobile`, scoring 70), confirming that scores meaningfully reflect real repository conditions rather than static output.

## Running locally

```bash
npm install
cp .env.example .env   # fill in your keys
npx ts-node provider.ts
```

### Environment variables

| Variable | Description |
|---|---|
| `CROO_API_URL` | Croo backend API URL |
| `CROO_WS_URL` | Croo WebSocket URL |
| `CROO_SDK_KEY` | Provider SDK key from Croo Dashboard |
| `GROQ_API_KEY` | Groq API key (free tier) |
| `GITHUB_TOKEN` | Optional, increases GitHub API rate limits |

## Deployment

Runs continuously via PM2 on a lightweight VPS (2 vCPU / 2GB RAM is sufficient, as the agent is I/O-bound rather than compute-bound):

```bash
pm2 start provider.ts --name "repo-doctor" --interpreter node --interpreter-args="-r ts-node/register"
pm2 save
pm2 startup
```

## Built for

[Croo Hackathon](https://dorahacks.io/hackathon/croo-hackathon/detail) — Developer Tooling Agents track.
