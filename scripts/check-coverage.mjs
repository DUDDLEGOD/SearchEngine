import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "coverage/lcov.info";
const threshold = Number(process.argv[3] ?? "85");

const content = readFileSync(path, "utf8");
const lines = content.split(/\r?\n/);

let totalFound = 0;
let totalHit = 0;

for (const line of lines) {
  if (!line.startsWith("DA:")) {
    continue;
  }

  const [, hitPart] = line.slice(3).split(",");
  const hitCount = Number(hitPart ?? "0");
  totalFound += 1;
  if (hitCount > 0) {
    totalHit += 1;
  }
}

if (totalFound === 0) {
  console.error("No coverage data found in lcov file.");
  process.exit(1);
}

const coverage = (totalHit / totalFound) * 100;
console.log(`Line coverage: ${coverage.toFixed(2)}% (threshold ${threshold}%)`);

if (coverage < threshold) {
  console.error("Coverage threshold not met.");
  process.exit(1);
}
