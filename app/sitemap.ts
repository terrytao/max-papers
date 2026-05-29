// XML sitemap for max-papers.com. Includes every indexable URL —
// landing + tabs + every paper, topic, method, journal, institute,
// and researcher-profile detail page.
//
// Next.js serves this at /sitemap.xml automatically. Submit to
// Google Search Console once max-papers.com is wired.
//
// Cap note: Google's per-sitemap limit is 50,000 URLs / 50 MB. We're
// well under for now (~12k entities). If we cross 50k we'll need
// to split into multiple sitemaps via sitemap.ts returning multiple
// indexes.

import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE = "https://www.max-papers.com";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [papers, topics, methods, journals, institutes, profiles] =
    await Promise.all([
      prisma.paper.findMany({ select: { id: true, updatedAt: true } }),
      prisma.topic.findMany({ select: { slug: true, updatedAt: true } }),
      prisma.method.findMany({ select: { slug: true, updatedAt: true } }),
      prisma.journal.findMany({ select: { slug: true, updatedAt: true } }),
      prisma.institute.findMany({ select: { slug: true, updatedAt: true } }),
      prisma.researchProfile.findMany({
        select: { id: true, updatedAt: true },
      }),
    ]);

  // Static surfaces first (highest priority).
  const staticEntries: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE}/browse`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/researchers`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/talent`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/talent?tab=browse`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/developer`, changeFrequency: "monthly", priority: 0.5 },
  ];

  return [
    ...staticEntries,
    ...papers.map((p) => ({
      url: `${BASE}/papers/${p.id}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...topics.map((t) => ({
      url: `${BASE}/topics/${t.slug}`,
      lastModified: t.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...methods.map((m) => ({
      url: `${BASE}/methods/${m.slug}`,
      lastModified: m.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...journals.map((j) => ({
      url: `${BASE}/journals/${j.slug}`,
      lastModified: j.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...institutes.map((i) => ({
      url: `${BASE}/institutes/${i.slug}`,
      lastModified: i.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...profiles.map((r) => ({
      url: `${BASE}/talent/profile/${r.id}`,
      lastModified: r.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
