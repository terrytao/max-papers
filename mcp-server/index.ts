// maxpaper MCP server — stdio transport for Claude Desktop / Cursor /
// any MCP client.
//
// Three tools:
//   • search_papers — keyword + filter search across the indexed corpus
//   • get_paper     — fetch full detail by Paper.id, DOI, or arXiv ID
//   • submit_paper  — accept an arXiv URL/ID; auto-fetches metadata
//                     from export.arxiv.org and publishes
//
// Setup notes specific to this project:
//   1. Prisma 7 dropped `url = env(...)` in schema.prisma, so the
//      runtime PrismaClient needs the @prisma/adapter-pg pattern with
//      an explicit connectionString. `new PrismaClient()` alone
//      throws InitializationError.
//   2. We're an ESM module (package.json "type":"module"), so
//      __dirname is unavailable — resolve via import.meta.url.
//   3. dotenv must load BEFORE PrismaClient is constructed; we do
//      both possible .env paths (parent-dir for dev runs from
//      mcp-server/, and same-dir as a fallback).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compiled to dist/index.js, so ../.env is the mcp-server local env
// (rarely used) and ../../.env is the max-papers project env (the
// real one with DATABASE_URL pointed at Neon).
loadEnv({ path: resolve(__dirname, "../../.env") });
loadEnv({ path: resolve(__dirname, "../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL not set. Looked in max-papers/.env and mcp-server/.env.",
  );
  process.exit(1);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const server = new McpServer({
  name: "max-papers",
  version: "1.0.0",
  description: "Search the maxpaper research index in plain English",
});

// Flexible author-name search via raw SQL. Each whitespace-separated
// word in the search term must appear somewhere in the same author
// entry, in any order — handles "Smith, Peter", "Peter J. Smith",
// "Peter Smith", "Smith Peter". Doesn't help "P. Smith" matching
// "Peter" (initial-vs-full-name aliasing is a separate problem).
async function findPapersByPartialAuthor(author: string): Promise<string[]> {
  if (author.length < 2) return [];
  const parts = author
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[.,;]/g, ""))
    .filter((p) => p.length > 1);
  if (parts.length === 0) return [];
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const likeClauses = parts.map(
    (p) => Prisma.sql`a ILIKE ${`%${esc(p)}%`}`,
  );
  const conjunction = Prisma.join(likeClauses, " AND ");
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Paper"
    WHERE EXISTS (
      SELECT 1 FROM unnest(authors) AS a
      WHERE ${conjunction}
    )
    LIMIT 1000
  `);
  return rows.map((r) => r.id);
}

server.tool(
  "search_papers",
  "Search research papers by topic, author, year, journal, or any natural-language query. Returns up to 20 results sorted by citation count.",
  {
    query: z
      .string()
      .describe("Free-text search across title, abstract, and keywords"),
    author: z.string().optional().describe("Exact author-name match"),
    afterYear: z
      .number()
      .optional()
      .describe("Only return papers published in or after this year"),
    journal: z
      .string()
      .optional()
      .describe("Journal or conference name (case-insensitive contains)"),
    openAccess: z
      .boolean()
      .optional()
      .describe("If true, only open-access papers"),
    limit: z.number().optional().default(10),
  },
  async ({ query, author, afterYear, journal, openAccess, limit }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ands: any[] = [];
    if (query) {
      ands.push({
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { abstract: { contains: query, mode: "insensitive" } },
          { keywords: { has: query.toLowerCase() } },
        ],
      });
    }
    if (author) {
      const ids = await findPapersByPartialAuthor(author);
      ands.push({ id: { in: ids } });
    }
    if (ands.length > 0) where.AND = ands;
    if (afterYear) where.year = { gte: afterYear };
    if (journal) where.journal = { contains: journal, mode: "insensitive" };
    if (openAccess) where.isOpenAccess = true;

    const papers = await prisma.paper.findMany({
      where,
      take: Math.min(limit ?? 10, 20),
      orderBy: { citationCount: "desc" },
      select: {
        id: true,
        title: true,
        authors: true,
        year: true,
        journal: true,
        abstract: true,
        isOpenAccess: true,
        citationCount: true,
        pdfUrl: true,
        url: true,
        fields: true,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: papers.length,
              source: "max-papers.com",
              results: papers.map((p) => ({
                title: p.title,
                authors: p.authors,
                year: p.year,
                journal: p.journal,
                fields: p.fields,
                abstract: p.abstract
                  ? p.abstract.slice(0, 300) +
                    (p.abstract.length > 300 ? "…" : "")
                  : null,
                openAccess: p.isOpenAccess,
                citations: p.citationCount,
                url: `https://www.max-papers.com/papers/${p.id}`,
                pdf: p.pdfUrl ?? null,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "get_paper",
  "Get full details of a specific paper by Paper.id, DOI, or arXiv ID. Provide at least one.",
  {
    id: z.string().optional(),
    doi: z.string().optional(),
    arxivId: z.string().optional(),
  },
  async ({ id, doi, arxivId }) => {
    const ors: Array<Record<string, string>> = [];
    if (id) ors.push({ id });
    if (doi) ors.push({ doi });
    if (arxivId) ors.push({ arxivId });
    if (ors.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Provide id, doi, or arxivId" }),
          },
        ],
      };
    }
    const paper = await prisma.paper.findFirst({ where: { OR: ors } });
    if (!paper) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: "Paper not found" }) },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              source: "max-papers.com",
              url: `https://www.max-papers.com/papers/${paper.id}`,
              paper,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "submit_paper",
  "Submit a research paper to max-papers.com — goes live immediately. Prefer arxivUrl/arxivId so metadata is auto-fetched from export.arxiv.org.",
  {
    arxivUrl: z
      .string()
      .optional()
      .describe("arXiv URL (e.g. https://arxiv.org/abs/2403.12345)"),
    arxivId: z.string().optional().describe("arXiv ID e.g. 2403.12345"),
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    abstract: z.string().optional(),
    journal: z.string().optional(),
    year: z.number().optional(),
  },
  async ({ arxivUrl, arxivId, title, authors, abstract, journal, year }) => {
    let id = arxivId;
    if (arxivUrl && !id) {
      const m = arxivUrl.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]+\.[0-9]+)(v\d+)?/i);
      if (m) id = m[1];
    }

    const metadata: {
      title?: string;
      authors?: string[];
      abstract?: string;
      journal?: string;
      year?: number;
      arxivId?: string;
      url?: string;
      pdfUrl?: string;
      isOpenAccess?: boolean;
    } = { title, authors, abstract, journal, year };

    if (id) {
      try {
        const res = await fetch(
          `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
          {
            headers: {
              "User-Agent":
                "max-papers-mcp/1.0 (mailto:terry.tao@max-robotics.com)",
            },
            signal: AbortSignal.timeout(15_000),
          },
        );
        const xml = await res.text();
        if (/<entry>/.test(xml)) {
          const titles = xml.match(/<title>([\s\S]+?)<\/title>/g);
          const paperTitle = (titles?.[1] ?? "")
            .replace(/<\/?title>/g, "")
            .replace(/\s+/g, " ")
            .trim();
          const summary = xml.match(/<summary>([\s\S]+?)<\/summary>/);
          const summaryText = (summary?.[1] ?? "").replace(/\s+/g, " ").trim();
          const authorMatches = [
            ...xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g),
          ];
          if (paperTitle) metadata.title = paperTitle;
          if (summaryText) metadata.abstract = summaryText;
          if (authorMatches.length)
            metadata.authors = authorMatches.map((m) => m[1]!.trim());
          metadata.arxivId = id;
          metadata.url = `https://arxiv.org/abs/${id}`;
          metadata.pdfUrl = `https://arxiv.org/pdf/${id}`;
          metadata.isOpenAccess = true;
        }
      } catch {
        // fall through with whatever caller-supplied metadata we have
      }
    }

    if (!metadata.title) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error:
                "Could not fetch paper metadata from arXiv. Provide arxivId/arxivUrl that resolves, or supply title manually.",
            }),
          },
        ],
      };
    }

    const orClauses: Array<Record<string, unknown>> = [];
    if (metadata.arxivId) orClauses.push({ arxivId: metadata.arxivId });
    orClauses.push({
      title: { equals: metadata.title, mode: "insensitive" },
    });
    const existing = await prisma.paper.findFirst({
      where: { OR: orClauses },
      select: { id: true, title: true },
    });
    if (existing) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "already_exists",
              message: "This paper is already on max-papers.com",
              title: existing.title,
              url: `https://www.max-papers.com/papers/${existing.id}`,
            }),
          },
        ],
      };
    }

    const paper = await prisma.paper.create({
      data: {
        title: metadata.title.slice(0, 1000),
        abstract: (metadata.abstract ?? "").slice(0, 5000),
        authors: (metadata.authors ?? []).slice(0, 30),
        year: metadata.year ?? new Date().getFullYear(),
        journal: metadata.journal ?? null,
        arxivId: metadata.arxivId ?? null,
        url: metadata.url ?? null,
        pdfUrl: metadata.pdfUrl ?? null,
        isOpenAccess: metadata.isOpenAccess ?? false,
        submittedVia: "mcp",
        publishedAt: new Date(),
        fields: [],
        keywords: [],
      },
      select: { id: true, title: true },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "live",
            message: "✅ Paper is now live on max-papers.com",
            title: paper.title,
            url: `https://www.max-papers.com/papers/${paper.id}`,
          }),
        },
      ],
    };
  },
);

server.tool(
  "find_positions",
  "Find research positions (PhD, postdoc, jobs, fellowships, grants) on max-papers.com matching the given filters. Returns up to 20 open positions sorted by most-recently-posted.",
  {
    topic: z
      .string()
      .optional()
      .describe("Research topic — exact match against Position.researchTopics"),
    type: z
      .string()
      .optional()
      .describe("phd | postdoc | job | fellowship | grant"),
    institution: z.string().optional(),
    country: z.string().optional(),
    funded: z
      .boolean()
      .optional()
      .describe("If true, only funded positions"),
    limit: z.number().optional().default(10),
  },
  async ({ topic, type, institution, country, funded, limit }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { status: "open" };
    if (type) where.type = type;
    if (institution)
      where.institution = { contains: institution, mode: "insensitive" };
    if (country) where.country = { contains: country, mode: "insensitive" };
    if (funded) where.funded = true;
    if (topic) where.researchTopics = { has: topic };

    const positions = await prisma.position.findMany({
      where,
      take: Math.min(limit ?? 10, 20),
      orderBy: [
        { deadline: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      include: {
        postedBy: { select: { name: true, institution: true } },
      },
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: positions.length,
              source: "max-papers.com/talent",
              results: positions.map((p) => ({
                id: p.id,
                title: p.title,
                type: p.type,
                institution: p.institution,
                country: p.country,
                funded: p.funded,
                deadline: p.deadline?.toISOString().split("T")[0] ?? null,
                topics: p.researchTopics,
                postedBy: p.postedBy.name,
                url: `https://www.max-papers.com/talent/positions/${p.id}`,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "get_research_matches",
  "Get positions that match a researcher's profile, ranked by the AI matching score (topic overlap, citation signal, methods, venues, field, publication count).",
  {
    profileId: z
      .string()
      .describe("ResearchProfile.id (cuid) on max-papers.com"),
    minScore: z.number().optional().default(50),
    limit: z.number().optional().default(10),
  },
  async ({ profileId, minScore, limit }) => {
    const matches = await prisma.match.findMany({
      where: { profileId, score: { gte: minScore ?? 50 } },
      take: Math.min(limit ?? 10, 20),
      orderBy: { score: "desc" },
      include: {
        position: {
          include: {
            postedBy: { select: { name: true, institution: true } },
          },
        },
      },
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: matches.length,
              source: "max-papers.com/talent",
              results: matches.map((m) => ({
                score: m.score,
                position: m.position.title,
                positionId: m.position.id,
                institution: m.position.institution,
                type: m.position.type,
                breakdown: {
                  topic: m.topicScore,
                  citation: m.citationScore,
                  method: m.methodScore,
                  venue: m.venueScore,
                },
                reasons: m.reasons,
                sharedTopics: m.sharedTopics,
                sharedMethods: m.sharedMethods,
                url: `https://www.max-papers.com/talent/positions/${m.position.id}`,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("max-papers MCP server running (stdio)");
