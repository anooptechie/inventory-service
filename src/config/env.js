require("dotenv").config();

const requiredEnv = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "REDIS_URL",
  "JWT_SECRET",
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing env variable: ${key}`);
  }
});

module.exports = {
  port: process.env.PORT || 5000,
  postgres: {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false },  // required for Supabase
  },
  redis: {
    url: process.env.REDIS_URL,          // changed from host/port
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
};