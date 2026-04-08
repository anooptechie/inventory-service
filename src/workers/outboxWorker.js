const pool = require("../db/postgres");

const processOutbox = async () => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM outbox_events
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT 10`
    );

    for (const event of rows) {
      try {
        console.log("Delivering:", event.type);

        // 🔹 Simulate external call
        // later → axios.post(notification-service)

        await pool.query(
          `UPDATE outbox_events
           SET status = 'DELIVERED', delivered_at = NOW()
           WHERE id = $1`,
          [event.id]
        );

      } catch (err) {
        await pool.query(
          `UPDATE outbox_events
           SET attempts = attempts + 1,
               last_error = $1
           WHERE id = $2`,
          [err.message, event.id]
        );
      }
    }

  } catch (err) {
    console.error("Worker error:", err);
  }
};

setInterval(processOutbox, 5000);