const { outboxEventsCreated } = require("../utils/metrics");

const writeEvent = async (client, type, payload) => {
  await client.query(
    `INSERT INTO outbox_events (type, payload, status)
     VALUES ($1, $2, 'PENDING')`,
    [type, JSON.stringify(payload)]
  );

  // 🔥 METRIC: event created
  outboxEventsCreated.inc();
};

module.exports = { writeEvent };