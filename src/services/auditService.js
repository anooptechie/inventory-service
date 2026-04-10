const writeAuditLog = async (
  client,
  { entityType, entityId, action, metadata }
) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
     VALUES ($1, $2, $3, $4)`,
    [entityType, entityId, action, JSON.stringify(metadata || {})]
  );
};

module.exports = { writeAuditLog };