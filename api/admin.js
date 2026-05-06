// Admin API endpoints for user management
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Service role client for admin operations
const adminSb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Auth helper (reused from main API)
async function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const { createClient: make } = require('@supabase/supabase-js');
    const userSb = make(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await adminSb.from('profiles').select('*').eq('id', user.id).single();
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch(e) {
    return null;
  }
}

// Middleware to check admin role
async function requireAdmin(req, res, next) {
  const auth = await authUser(req);
  if (!auth || auth.profile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.auth = auth;
  next();
}

module.exports = function(app) {
  
  // PATCH /api/admin/users/:id - Update user (suspend/activate, change role)
  app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { suspended, role } = req.body;
      
      const updates = {};
      if (typeof suspended === 'boolean') updates.suspended = suspended;
      if (role && ['user', 'business', 'admin'].includes(role)) updates.role = role;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid updates provided' });
      }
      
      const { data, error } = await adminSb
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      res.json({ success: true, profile: data });
    } catch(e) {
      console.error('Admin user update error:', e);
      res.status(500).json({ error: e.message });
    }
  });
  
  // POST /api/admin/users/:id/trial - Grant free trial
  app.post('/api/admin/users/:id/trial', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { months } = req.body;
      
      if (![1, 2, 3].includes(months)) {
        return res.status(400).json({ error: 'Months must be 1, 2, or 3' });
      }
      
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + months);
      
      const { data, error } = await adminSb
        .from('profiles')
        .update({ trial_expires_at: expiresAt.toISOString() })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      res.json({ success: true, trial_expires_at: data.trial_expires_at });
    } catch(e) {
      console.error('Admin trial grant error:', e);
      res.status(500).json({ error: e.message });
    }
  });
  
  // GET /api/admin/users - List all users (optional, for server-side filtering)
  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
      const { data, error } = await adminSb
        .from('profiles')
        .select('id,email,role,full_name,trial_expires_at,suspended,created_at')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      res.json({ users: data });
    } catch(e) {
      console.error('Admin users list error:', e);
      res.status(500).json({ error: e.message });
    }
  });
  
};
