const { Pool } = require("pg");
const config = require("../config/env");

const pool = new Pool(config.postgres);

pool.on("connect", () => {
  console.log("Postgres connected");
});

pool.on("error", (err) => {
  console.error("Postgres error", err);
  process.exit(1);
});

module.exports = pool;