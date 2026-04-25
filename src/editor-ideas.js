import { readJson } from "./storage.js";

const briefs = await readJson("data/editor-briefs.json", []);
const today = new Date().toISOString().slice(0, 10);

console.log(`Editorial ideas for ${today}`);
console.log("");

briefs.forEach((brief, index) => {
  const topic = brief.example_topics[index % brief.example_topics.length];
  console.log(`${index + 1}. ${topic}`);
  console.log(`   Pillar: ${brief.pillar}`);
  console.log(`   Audience: ${brief.audience}`);
  console.log(`   Angle: ${brief.angle}`);
  console.log("");
});
