import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { runSeed } from "./runSeed";

const prisma = new PrismaClient();
const CHALLENGES = process.env.CHALLENGES_DIR ?? join(__dirname, "../../challenges");

runSeed(prisma, CHALLENGES)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
