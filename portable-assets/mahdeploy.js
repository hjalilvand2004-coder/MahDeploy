/**
 * MahDeploy portable bootstrap
 * ----------------------------
 * Boots the Next.js standalone server with zero external requirements:
 * no Python, no Node installation, no PyCharm — just the bundled runtime\node.exe.
 *
 * Responsibilities:
 *  1. Resolve the package root (works from any working directory / service mode)
 *  2. Guarantee data\ and logs\ folders exist next to the launcher
 *  3. Point DATABASE_URL at an absolute, forward-slash path (Prisma-safe on Windows)
 *  4. Load the compiled Next.js standalone server
 */
const path = require("path");
const fs = require("fs");

const root = process.env.MAHDEPLOY_ROOT
  ? path.resolve(process.env.MAHDEPLOY_ROOT)
  : path.resolve(__dirname, "..");

// data\mahdeploy.db — absolute path with forward slashes (Prisma-safe on Windows)
// Deterministic: always overrides shell/dotenv leftovers so the panel can never
// accidentally bind to a foreign database. Custom location: set MAHDEPLOY_DB env.
const dataDir = path.join(root, "data");
const logDir = path.join(root, "logs");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const dbPath = process.env.MAHDEPLOY_DB
  ? path.resolve(process.env.MAHDEPLOY_DB).replace(/\\/g, "/")
  : path.join(dataDir, "mahdeploy.db").replace(/\\/g, "/");

process.env.DATABASE_URL = "file:" + dbPath;
if (!process.env.PORT) process.env.PORT = "3000";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

console.log("==================================================");
console.log("  MahDeploy | استقراربان  —  Portable Edition");
console.log("--------------------------------------------------");
console.log("  Web Panel : http://localhost:" + process.env.PORT);
console.log("  Database  : " + dbPath);
console.log("  Login     : admin  /  admin1234  (change it!)");
console.log("==================================================");

// Hand over to the compiled Next.js standalone server
require("./server.js");
