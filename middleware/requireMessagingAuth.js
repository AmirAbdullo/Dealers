const jwt = require('jsonwebtoken');

module.exports = function requireMessagingAuthFactory(db, jwtSecret) {
  if (!db) throw new Error('requireMessagingAuthFactory: db is required');
  const secret = jwtSecret || process.env.JWT_SECRET || 'carfox-dev-secret-change-me';

  return function requireMessagingAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const parts = header.split(' ');
    if (parts[0] !== 'Bearer' || !parts[1]) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let decoded;
    try {
      decoded = jwt.verify(parts[1], secret);
    } catch (_) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = db
      .prepare('SELECT id, email, full_name, role, phone FROM users WHERE id = ?')
      .get(decoded.sub);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    req.user = user;
    req.messagingRole = user.role;

    if (user.role === 'dealer') {
      const dealership = db
        .prepare(
          'SELECT id, status, business_name, city, state FROM dealerships WHERE user_id = ?'
        )
        .get(user.id);
      if (!dealership || dealership.status !== 'approved') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.dealership = dealership;
    }

    return next();
  };
};
