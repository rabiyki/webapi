// Run with: node setup-mega-accounts.js
// Eta data/megaaccount.json file auto create/overwrite kore dey

const fs = require("fs");
const path = require("path");

// 👇 Ekhane tomar mega account gulo add/edit koro (jotota lage rakhte paro)
const accounts = [
  {
    email: "oyysreejan8@gmail.com",
    password: "sreejan900"
  },
  {
    email: "oyysreejan8@gmail.com",
    password: "sreejan900"
  }
];

const dataDir = path.join(__dirname, "data");
const filePath = path.join(dataDir, "megaaccount.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("📁 data/ folder create kora holo");
}

fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), "utf-8");

console.log(`✅ ${accounts.length} ta account save hoye gelo -> ${filePath}`);
