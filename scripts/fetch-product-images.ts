import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PRODUCTS } from "../prisma/seed/data/catalogue";
import { slugify } from "../prisma/seed/lib/helpers";

/**
 * Downloads a deterministic placeholder image per product into public/products,
 * matching the URLs the seed writes into ProductImage.
 *
 * Decision D-13 in docs/PLAN.md: the files are fetched once and committed, so
 * the app renders real images with no network at runtime. picsum is seeded by
 * the product slug, so the same product always gets the same picture and the
 * catalogue does not reshuffle between runs.
 *
 * Run once after cloning: npm run db:images
 */
const OUT_DIR = join("public", "products");
const IMAGES_PER_PRODUCT = 2;
const SIZE = 800;

async function download(url: string, destination: string): Promise<boolean> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    console.error(`  failed ${response.status}  ${destination}`);
    return false;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
  return true;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of PRODUCTS) {
    const slug = slugify(product.name);
    for (let index = 1; index <= IMAGES_PER_PRODUCT; index += 1) {
      const filename = `${slug}-${index}.jpg`;
      const destination = join(OUT_DIR, filename);

      if (existsSync(destination)) {
        skipped += 1;
        continue;
      }

      const url = `https://picsum.photos/seed/${slug}-${index}/${SIZE}/${SIZE}`;
      const ok = await download(url, destination);
      if (ok) {
        fetched += 1;
        console.log(`  ${filename}`);
      } else {
        failed += 1;
      }
    }
  }

  console.log(`\n${fetched} fetched, ${skipped} already present, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
