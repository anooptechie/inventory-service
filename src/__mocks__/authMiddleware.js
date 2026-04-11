const authenticate = (req, res, next) => {
  req.user = {
    userId: "test-user-id",
    role: "admin",
    isActive: true,
  };
  next();
};

const authorize = () => (req, res, next) => next();

module.exports = {
  authenticate,
  authorize,
};