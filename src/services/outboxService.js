const writeEvent = async (client, type, payload) => {
  await client.query(
    `INSERT INTO outbox_events (type, payload, status)
     VALUES ($1, $2, 'PENDING')`,
    [type, JSON.stringify(payload)]
  );
};

module.exports = { writeEvent };