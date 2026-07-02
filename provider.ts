import { AgentClient, EventType, DeliverableType } from "@croo-network/sdk";
import axios from "axios";
import Groq from "groq-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

interface RepoSnapshot {
  fullName: string;
  description: string | null;
  stars: number;
  hasReadme: boolean;
  readmeLength: number;
  openIssues: number;
  defaultBranch: string;
  lastPushedAt: string;
  hasTestDir: boolean;
  testFileCount: number;
  testFramework: string | null;
  topLevelFiles: string[];
  packageJson: string | null;
}

async function fetchGitHubRepo(owner: string, repo: string): Promise<RepoSnapshot> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repoRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  const contentsRes = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents`,
    { headers }
  );

  const topLevelFiles: string[] = contentsRes.data.map((f: any) => f.name);
  const hasReadme = topLevelFiles.some((f) => f.toLowerCase().startsWith("readme"));

  const testDirCandidates = ["test", "tests", "__tests__", "spec"];
  const testDirName = topLevelFiles.find((f) =>
    testDirCandidates.includes(f.toLowerCase())
  );

  let readmeLength = 0;
  if (hasReadme) {
    try {
      const readmeRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        { headers }
      );
      const content = Buffer.from(readmeRes.data.content, "base64").toString("utf-8");
      readmeLength = content.length;
    } catch {
      readmeLength = 0;
    }
  }

  let packageJson: string | null = null;
  if (topLevelFiles.includes("package.json")) {
    try {
      const pkgRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/package.json`,
        { headers }
      );
      packageJson = Buffer.from(pkgRes.data.content, "base64").toString("utf-8");
    } catch {
      packageJson = null;
    }
  }

  // Count files inside the test directory (one level deep) for a stronger signal
  // than just checking whether the directory exists.
  let testFileCount = 0;
  if (testDirName) {
    try {
      const testDirRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/${testDirName}`,
        { headers }
      );
      if (Array.isArray(testDirRes.data)) {
        testFileCount = testDirRes.data.filter((f: any) => f.type === "file").length;
      }
    } catch {
      testFileCount = 0;
    }
  }

  // Try to detect the test framework from package.json dependencies.
  let testFramework: string | null = null;
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const knownFrameworks = ["jest", "mocha", "vitest", "ava", "jasmine", "tape", "chai"];
      const found = knownFrameworks.find((fw) => deps && deps[fw]);
      if (found) testFramework = found;
    } catch {
      testFramework = null;
    }
  }

  return {
    fullName: repoRes.data.full_name,
    description: repoRes.data.description,
    stars: repoRes.data.stargazers_count,
    hasReadme,
    readmeLength,
    openIssues: repoRes.data.open_issues_count,
    defaultBranch: repoRes.data.default_branch,
    lastPushedAt: repoRes.data.pushed_at,
    hasTestDir: !!testDirName,
    testFileCount,
    testFramework,
    topLevelFiles,
    packageJson,
  };
}

async function analyzeWithGroq(snapshot: RepoSnapshot) {
  const prompt = `You are a senior software engineer performing a repository health audit.
Analyze the following repository metadata and return ONLY a valid JSON object (no markdown, no explanation outside JSON) with this exact structure:

{
  "overall_score": <integer 0-100>,
  "readme_quality": { "score": <0-100>, "comment": "<short comment>" },
  "test_coverage_signal": { "score": <0-100>, "comment": "<short comment>" },
  "dependency_health": { "score": <0-100>, "comment": "<short comment>" },
  "maintenance_activity": { "score": <0-100>, "comment": "<short comment>" },
  "recommendations": ["<short actionable recommendation>", "..."]
}

Repository data:
${JSON.stringify(snapshot, null, 2)}

Rules:
- All text must be in English.
- "recommendations" must contain 3 to 5 concise, actionable items.
- Base "dependency_health" on package.json content if present, otherwise give a neutral score of 50 and note that no manifest was found.
- Base "maintenance_activity" on lastPushedAt recency and openIssues count.
- For "test_coverage_signal": this is a shallow signal based on presence and file count of a test directory, NOT a real coverage measurement. If hasTestDir is false, score must be 20 or lower and the comment must state no test directory was found. If hasTestDir is true but testFileCount is 0-2, score should be 30-50 and the comment should note the low file count. If testFileCount is higher, score can rise proportionally, but the comment must explicitly say this reflects test file presence/count, not measured code coverage, and must mention the detected framework if testFramework is not null.
- Respond with raw JSON only.`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

function parseRequirements(raw: string): { owner: string; repo: string } | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.owner && parsed.repo) {
      return { owner: parsed.owner, repo: parsed.repo };
    }
    if (typeof parsed === "string" && parsed.includes("/")) {
      const [owner, repo] = parsed.split("/");
      return { owner, repo };
    }
    return null;
  } catch {
    if (raw.includes("/")) {
      const [owner, repo] = raw.trim().split("/");
      return { owner, repo };
    }
    return null;
  }
}

async function main() {
  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL!,
      wsURL: process.env.CROO_WS_URL!,
    },
    process.env.CROO_SDK_KEY!
  );

  const stream = await client.connectWebSocket();
  console.log("Provider connected. Waiting for orders...");

  stream.on(EventType.NegotiationCreated, async (e) => {
    console.log(`New negotiation received: ${e.negotiation_id}`);
    try {
      const negotiation = await client.getNegotiation(e.negotiation_id!);
      const parsed = parseRequirements(negotiation.requirements);

      if (!parsed) {
        console.error("Could not parse owner/repo from requirements:", negotiation.requirements);
        await client.rejectNegotiation(
          e.negotiation_id!,
          "Invalid requirements format. Expected JSON: {\"owner\": \"...\", \"repo\": \"...\"}"
        );
        return;
      }

      const result = await client.acceptNegotiation(e.negotiation_id!);
      console.log(`Negotiation accepted. Order created: ${result.order.orderId}`);
    } catch (err: any) {
      console.error("Error handling negotiation:", err.message ?? err);
    }
  });

  stream.on(EventType.OrderPaid, async (e) => {
    console.log(`Order ${e.order_id} paid. Starting analysis...`);
    try {
      const order = await client.getOrder(e.order_id!);
      const negotiation = await client.getNegotiation(order.negotiationId);
      const parsed = parseRequirements(negotiation.requirements);

      if (!parsed) {
        throw new Error("Could not parse owner/repo at delivery time.");
      }

      console.log(`Analyzing ${parsed.owner}/${parsed.repo}...`);
      const snapshot = await fetchGitHubRepo(parsed.owner, parsed.repo);
      const report = await analyzeWithGroq(snapshot);

      await client.deliverOrder(e.order_id!, {
        deliverableType: DeliverableType.Schema,
        deliverableSchema: JSON.stringify(report),
      });

      console.log(`Order ${e.order_id} delivered successfully.`);
    } catch (err: any) {
      console.error("Error during delivery:", err.message ?? err);
      try {
        await client.deliverOrder(e.order_id!, {
          deliverableType: DeliverableType.Text,
          deliverableText: `Analysis failed: ${err.message ?? "unknown error"}`,
        });
      } catch (deliverErr) {
        console.error("Failed to deliver error message:", deliverErr);
      }
    }
  });

  stream.on(EventType.OrderCompleted, (e) => {
    console.log(`Order ${e.order_id} completed and cleared!`);
  });

  stream.on(EventType.NegotiationRejected, (e) => {
    console.log(`Negotiation ${e.negotiation_id} was rejected. Reason: ${e.reason}`);
  });

  stream.on(EventType.OrderExpired, (e) => {
    console.log(`Order ${e.order_id} expired.`);
  });

  process.on("SIGINT", () => {
    console.log("Shutting down provider...");
    stream.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting provider:", err);
  process.exit(1);
});
