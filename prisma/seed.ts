import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Idempotent seed: creates the ten chapter domains once, reconciles
 * names for existing rows, and never deletes user data. Safe to rerun.
 */
const DOMAINS: Array<{ name: string; slug: string; description: string }> = [
  { name: "Web Development", slug: "web-development", description: "Frontend, backend and full-stack projects of the chapter." },
  { name: "Machine Learning", slug: "machine-learning", description: "ML research, kaggle, and applied intelligence projects." },
  { name: "Competitive Programming", slug: "competitive-programming", description: "Contests, practice and problem-solving activities." },
  { name: "Cyber Security", slug: "cyber-security", description: "Security research, CTFs and safe computing initiatives." },
  { name: "Marketing", slug: "marketing", description: "Campaigns, outreach and growth activities." },
  { name: "Social Media", slug: "social-media", description: "Chapter social channels and content." },
  { name: "Design and Branding", slug: "design-and-branding", description: "Visual design, brand assets and creative work." },
  { name: "Administration", slug: "administration", description: "Operational, logistic and organizational work." },
  { name: "App Development", slug: "app-development", description: "Mobile and desktop app projects." },
  { name: "Public Relations", slug: "public-relations", description: "Partnerships, communications and community relations." },
];

const prisma = new PrismaClient();

async function main() {
  for (const domain of DOMAINS) {
    await prisma.domain.upsert({
      where: { slug: domain.slug },
      update: { name: domain.name, description: domain.description },
      create: { name: domain.name, slug: domain.slug, description: domain.description },
    });
    // Do not delete or archive anything here: reconciliation only.
  }
  const count = await prisma.domain.count();
  console.log(`[seed] domains ensured (total ${count})`);
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
