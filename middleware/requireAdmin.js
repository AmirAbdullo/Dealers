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
      // Only admin-session tokens (POST /api/admin/login: 'carfox-admin' audience, 12h) are accepted here;
      // buyer/dealer site tokens fail the audience check.
      decoded = jwt.verify(parts[1], secret, { audience: 'carfox-admin' });
    } catch (_) {
      return res.status(401).json({ error: 'Admin session expired or invalid. Please sign in again.' });
    }

    const user = db
      .prepare('SELECT id, email, full_name, role, password_changed_at FROM users WHERE id = ?')
      .get(decoded.sub);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    // Sessions issued before the last password change are revoked.
    if (user.password_changed_at && Number(decoded.iat || 0) < Number(user.password_changed_at)) {
      return res.status(401).json({ error: 'Admin session expired or invalid. Please sign in again.' });
    }
    delete user.password_changed_at;
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    return next();
  };
};

