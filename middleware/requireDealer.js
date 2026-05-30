const jwt = require('jsonwebtoken');

module.exports = function requireDealerFactory(db, jwtSecret) {
  if (!db) throw new Error('requireDealerFactory: db is required');
  const secret = jwtSecret || process.env.JWT_SECRET || 'carfox-dev-secret-change-me';

  return function requireDealer(req, res, next) {
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
    const user = db.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?').get(decoded.sub);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    if (user.role !== 'dealer') return res.status(403).json({ error: 'Only approved dealers can list vehicles' });
    const dealership = db.prepare('SELECT id, status, business_name FROM dealerships WHERE user_id = ?').get(user.id);
    if (!dealership || dealership.status !== 'approved') {
      return res.status(403).json({ error: 'Only approved dealers can list vehicles' });
    }
    req.user = user;
    req.dealership = dealership;
    return next();
  };
}

