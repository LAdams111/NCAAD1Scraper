import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("tmp-index.html", "utf8");
const marker = '"PLAYERID": "736073"';
const start = html.indexOf("{", html.indexOf(marker) - 1);
const end = html.indexOf("}", start) + 1;
const acuffRow = html.slice(start, end);

const zeroRow =
  '{"PLAYERID": "740747","PLAYERNAME": "Abaev Shon","TEAMNAME": "FSU","POSITION": "G","Games": "0","PTS": "0","REBT": "0","AS": "0","ST": "0","BS": "0","FGPM2": "0","FGPA2": "0","FGPM3": "0","FGPA3": "0"}';

const mini = `<script>var strData;strData='[${acuffRow},${zeroRow}]';</script>`;
mkdirSync("src/test/fixtures", { recursive: true });
writeFileSync("src/test/fixtures/index-snippet.html", mini);
console.log("wrote fixture", acuffRow.slice(0, 80));
