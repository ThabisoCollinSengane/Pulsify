const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const sb = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Auth helper (consistent with other API files)
async function authUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const userSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await userSb.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await sb().from('profiles').select('*').eq('id', user.id).single();
    return { user, profile: profile || { id: user.id, role: 'user' } };
  } catch (e) {
    return null;
  }
}

// Unified Notifications API Handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Authenticate user
  const auth = await authUser(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { user } = auth;

  try {
    // GET - Fetch notifications for user
    if (req.method === 'GET') {
      const { data, error } = await sb()
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ notifications: data || [] });
    }

    // POST - Create new notification
    if (req.method === 'POST') {
      const { title, message, type, metadata, platform } = req.body;

      const notification = {
        user_id: user.id,
        title,
        message,
        type: type || 'info',
        metadata: metadata || {},
        platform: platform || 'web',
        read: false,
        created_at: new Date().toISOString()
      };

      const { data, error } = await sb()
        .from('notifications')
        .insert([notification])
        .select()
        .single();

      if (error) throw error;

      // Broadcast real-time update
      await sb()
        .channel(`notifications:${user.id}`)
        .send({
          type: 'broadcast',
          event: 'notification_created',
          payload: data
        });

      return res.status(201).json({ notification: data });
    }

    // PUT - Update notification (mark as read, etc.)
    if (req.method === 'PUT') {
      const { id, read, metadata } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Notification ID required' });
      }

      const updates = {};
      if (typeof read !== 'undefined') updates.read = read;
      if (metadata) updates.metadata = metadata;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await sb()
        .from('notifications')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      // Broadcast real-time update
      await sb()
        .channel(`notifications:${user.id}`)
        .send({
          type: 'broadcast',
          event: 'notification_updated',
          payload: data
        });

      return res.status(200).json({ notification: data });
    }

    // DELETE - Delete notification
    if (req.method === 'DELETE') {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Notification ID required' });
      }

      const { error } = await sb()
        .from('notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Broadcast real-time update
      await sb()
        .channel(`notifications:${user.id}`)
        .send({
          type: 'broadcast',
          event: 'notification_deleted',
          payload: { id }
        });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Notifications API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
