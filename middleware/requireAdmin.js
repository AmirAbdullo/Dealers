const jwt = require('jsonwebtoken');

// Factory: provide db and secret to create middleware
module.exports = function requireAdminFactory(db, jwtSecret) {
  if (!db) {
    throw new Error('requireAdminFactory: db is required');
  }
  const secret = jwtSecret || process.env.JWT_SECRET || 'carfox-dev-secret-change-me';

  return function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const parts = header.split(' ');
    if (parts[0] !== 'Bearer' || !parts[1]) {
      return res.status(401).json({ error: 'Missing token' });
    }

    let decoded;
    try {
      decoded = jwt.verify(parts[1], secret);
    } catch (_) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = db
      .prepare('SELECT id, email, full_name, role FROM users WHERE id = ?')
      .get(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    return next();
  };
};

