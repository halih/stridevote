import { PrismaClient } from "../src/generated/prisma";
import { rebuildVoterPropensity } from "./lib/rebuild-voter-propensity";

const prisma = new PrismaClient();

rebuildVoterPropensity(prisma)
  .then(async () => {
    const [primary, general] = await Promise.all([
      prisma.voter.count({ where: { likelyPrimary: true } }),
      prisma.voter.count({ where: { likelyGeneral: true } }),
    ]);
    console.log(
      `Propensity rebuilt: ${primary.toLocaleString()} likely primary, ${general.toLocaleString()} likely general voters.`,
    );
  })
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
