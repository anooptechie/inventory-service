const fs = require("fs");
const path = require("path");
const pool = require("./postgres");

const runMigrations = async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsPath).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsPath, file), "utf-8");
    console.log(`Running ${file}`);
    await pool.query(sql);
  }

  console.log("All migrations completed");
  process.exit(0);
};

runMigrations().catch((err) => {
  console.error("Migration failed", err);
  process.exit(1);
});