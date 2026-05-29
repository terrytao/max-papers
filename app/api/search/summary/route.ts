// /api/search/summary — second-stage summary generation called by
// the frontend after /api/search results paint. Splitting this off
// the main search endpoint lets papers reach the user in <1s while
// the slower Claude summary call happens in parallel and fades in
// when ready.
//
// Input shape: { topic: string, papers: [{ title, abstract }] }.
// Frontend passes the top 3 papers from the search result it
// already has — no DB round-trip needed here.
//
// Guards on a public anonymous endpoint:
//   • topic ≤ 500 chars
//   • max 3 papers used (extra ignored)
//   • title ≤ 300 chars, abstract ≤ 200 chars per paper
//   • Haiku 4.5 (cheap), 180 output token cap
//   • 30s wall-clock — summary never blocks longer than this

import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOPIC_CHARS = 500;
const MAX_PAPERS = 3;
const MAX_TITLE_CHARS = 300;
const MAX_ABSTRACT_CHARS = 200;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type SummaryBody = {
  topic?: string;
  papers?: Array<{ title?: string; abstract?: string }>;
};

export async function POST(req: NextRequest) {
  let body: SummaryBody;
  try {
    body = (await req.json()) as SummaryBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim().slice(0, MAX_TOPIC_CHARS);
  const papers = Array.isArray(body.papers) ? body.papers.slice(0, MAX_PAPERS) : [];

  if (!topic || papers.length === 0) {
    return Response.json({ summary: "" });
  }

  const formatted = papers
    .map((p) => {
      const title = String(p.title ?? "").slice(0, MAX_TITLE_CHARS).trim();
      const abstract = String(p.abstract ?? "").slice(0, MAX_ABSTRACT_CHARS).trim();
      if (!title) return null;
      return `- ${title}: ${abstract}`;
    })
    .filter((s): s is string => !!s)
    .join("\n");

  if (!formatted) return Response.json({ summary: "" });

  const prompt = `Write a 2-sentence plain-English summary of what these papers say about "${topic}". Be specific, cite findings.

Papers:
${formatted}

Return only the summary, no preamble.`;

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 180,
      messages: [{ role: "user", content: prompt }],
    });
    const summary = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return Response.json({ summary });
  } catch (err) {
    console.error("[search/summary] failed:", (err as Error).message);
    return Response.json({ summary: "" });
  }
}
