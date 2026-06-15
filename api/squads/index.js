const { sb, sbAs, authUser, tokenFrom, CORS, verifyToken, rateLimited, captureError } = require('../shared');

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 100, windowMs: 60000 })) return;

  const url = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q   = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {

    // GET /squads — list current user's squads
    if (url === '/squads' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data: memberships } = await sb()
        .from('squad_members')
        .select('squad_id, role, joined_at, squads(id, name, description, avatar_url, is_public, member_count, total_points, template_type, created_at)')
        .eq('user_id', auth.user.id);
      return res.status(200).json({ squads: (memberships || []).map(m => ({ ...m.squads, role: m.role, joined_at: m.joined_at })) });
    }

    // POST /squads — create a squad
    if (url === '/squads' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { name, description, is_public = true, template_type = 'general' } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
      const { data: squad, error } = await sb()
        .from('squads')
        .insert({ name: name.trim(), description: description?.trim() || null, creator_id: auth.user.id, is_public, template_type })
        .select('id, name, description, avatar_url, is_public, member_count, total_points, template_type, template_config, created_at')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      const { error: memErr } = await sb().from('squad_members').insert({ squad_id: squad.id, user_id: auth.user.id, role: 'admin' });
      if (memErr) {
        // Rollback the squad if we can't add the creator — prevents orphaned squads where creator can't see plans
        await sb().from('squads').delete().eq('id', squad.id);
        return res.status(500).json({ error: 'Failed to add creator as member: ' + memErr.message });
      }
      return res.status(201).json({ squad });
    }

    // GET /squads/leaderboard — top squads by total_points
    if (url === '/squads/leaderboard' && req.method === 'GET') {
      const { data } = await sb()
        .from('squads')
        .select('id, name, avatar_url, member_count, total_points')
        .eq('is_public', true)
        .order('total_points', { ascending: false })
        .limit(10);
      return res.status(200).json({ leaderboard: data || [] });
    }

    // POST /squads/checkin — squad check-in awards 20 pts
    if (url === '/squads/checkin' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { squad_id, event_id } = req.body || {};
      if (!squad_id) return res.status(400).json({ error: 'squad_id required' });
      const userClient = sbAs(token);
      const { data: membership } = await userClient
        .from('squad_members')
        .select('role')
        .eq('squad_id', squad_id)
        .eq('user_id', auth.user.id)
        .single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      await userClient.from('squad_points').insert({ squad_id, user_id: auth.user.id, activity_type: 'squad_checkin', points: 20, event_id: event_id || null });
      await userClient.from('squad_activity').insert({ squad_id, user_id: auth.user.id, activity_type: 'squad_checkin', description: 'Squad check-in at event', data: event_id ? { event_id } : null });
      const { data: updated } = await sb().from('squads').select('total_points').eq('id', squad_id).single();
      return res.status(200).json({ ok: true, total_points: updated?.total_points });
    }

    // GET /squads/invites — pending invites for current user
    if (url === '/squads/invites' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { data: invites } = await sb()
        .from('squad_invites')
        .select('id, squad_id, inviter_id, status, created_at, squads(id, name, avatar_url), profiles!squad_invites_inviter_id_fkey(display_name, username, avatar_url)')
        .eq('invitee_id', auth.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return res.status(200).json({ invites: invites || [] });
    }

    const squadInviteActionMatch = url.match(/^\/squads\/invites\/([^/]+)\/(accept|reject)$/);

    // POST /squads/invites/:id/accept
    if (squadInviteActionMatch && squadInviteActionMatch[2] === 'accept' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const inviteId = squadInviteActionMatch[1];
      const { data: invite } = await sb().from('squad_invites').select('id, squad_id, status').eq('id', inviteId).eq('invitee_id', auth.user.id).single();
      if (!invite) return res.status(404).json({ error: 'Invite not found' });
      if (invite.status !== 'pending') return res.status(400).json({ error: 'Invite already processed' });
      await sb().from('squad_invites').delete().eq('id', inviteId);
      const { error } = await sb().from('squad_members').insert({ squad_id: invite.squad_id, user_id: auth.user.id, role: 'member' });
      if (error && !error.message.includes('duplicate')) return res.status(400).json({ error: error.message });
      const { data: squad } = await sb().from('squads').select('member_count').eq('id', invite.squad_id).single();
      await sb().from('squads').update({ member_count: (squad?.member_count || 1) + 1 }).eq('id', invite.squad_id);
      return res.status(200).json({ ok: true });
    }

    // POST /squads/invites/:id/reject
    if (squadInviteActionMatch && squadInviteActionMatch[2] === 'reject' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const inviteId = squadInviteActionMatch[1];
      await sb().from('squad_invites').delete().eq('id', inviteId).eq('invitee_id', auth.user.id);
      return res.status(200).json({ ok: true });
    }

    const squadPlanRsvpMatch = url.match(/^\/squads\/([^/]+)\/plans\/([^/]+)\/rsvp$/);
    const squadPlanDetailMatch = url.match(/^\/squads\/([^/]+)\/plans\/([^/]+)$/);
    const squadPlansMatch = url.match(/^\/squads\/([^/]+)\/plans$/);

    // POST /squads/:id/plans/:planId/rsvp
    if (squadPlanRsvpMatch && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanRsvpMatch;
      const { status: rsvpStatus } = req.body || {};
      if (!['going','maybe','not_going'].includes(rsvpStatus)) return res.status(400).json({ error: 'status must be going|maybe|not_going' });
      const { error } = await sbAs(token).from('squad_plan_rsvps').upsert({ plan_id: planId, user_id: auth.user.id, status: rsvpStatus }, { onConflict: 'plan_id,user_id' });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // PATCH /squads/:id/plans/:planId — update plan (creator only)
    if (squadPlanDetailMatch && req.method === 'PATCH') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanDetailMatch;
      const { title, notes, plan_date, plan_time, location_name, event_id } = req.body || {};
      const updates = {};
      if (title) updates.title = title.trim();
      if (notes !== undefined) updates.notes = notes;
      if (plan_date) updates.plan_date = plan_date;
      if (plan_time !== undefined) updates.plan_time = plan_time || null;
      if (location_name !== undefined) updates.location_name = location_name;
      if (event_id !== undefined) updates.event_id = event_id || null;
      const { error } = await sbAs(token).from('squad_plans').update(updates).eq('id', planId).eq('creator_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // DELETE /squads/:id/plans/:planId — delete plan (creator only)
    if (squadPlanDetailMatch && req.method === 'DELETE') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const [, , planId] = squadPlanDetailMatch;
      const { error } = await sbAs(token).from('squad_plans').delete().eq('id', planId).eq('creator_id', auth.user.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // GET /squads/:id/plans — list all plans with RSVPs
    if (squadPlansMatch && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadPlansMatch[1];
      // Use SECURITY DEFINER RPC — runs as postgres, bypasses RLS & grants entirely
      const { data: plans, error: plansErr } = await sb().rpc('get_squad_plans', {
        p_squad_id: squadId,
        p_user_id: auth.user.id,
      });
      if (plansErr) {
        if (plansErr.message?.includes('not_a_member')) return res.status(403).json({ error: 'Not a squad member' });
        return res.status(400).json({ error: plansErr.message });
      }
      return res.status(200).json({ plans: plans || [] });
    }

    // POST /squads/:id/plans — create a plan + notify members
    if (squadPlansMatch && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadPlansMatch[1];
      const { title, notes, plan_date, plan_time, location_name, event_id, outing_type, budget_per_person } = req.body || {};
      if (!title?.trim() || !plan_date) return res.status(400).json({ error: 'title and plan_date are required' });
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership) return res.status(403).json({ error: 'Not a squad member' });
      const { data: plan, error } = await sb().from('squad_plans')
        .insert({ squad_id: squadId, creator_id: auth.user.id, title: title.trim(), notes: notes || null, plan_date, plan_time: plan_time || null, location_name: location_name || null, event_id: event_id || null, outing_type: outing_type || 'general', budget_per_person: budget_per_person ? parseInt(budget_per_person) : null })
        .select('id, title, plan_date').single();
      if (error) return res.status(400).json({ error: error.message });
      const { data: members } = await sb().from('squad_members').select('user_id').eq('squad_id', squadId).neq('user_id', auth.user.id);
      const { data: planner } = await sb().from('profiles').select('display_name').eq('id', auth.user.id).single();
      const plannerName = planner?.display_name || 'Someone';
      const dateStr = new Date(plan_date + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
      if (members && members.length > 0) {
        const notifs = members.map(m => ({ user_id: m.user_id, type: 'squad_plan', from_user_id: auth.user.id, from_display_name: plannerName, entity_id: plan.id, entity_type: 'squad_plan', message: `${plannerName} planned "${title.trim()}" for ${dateStr}`, data: { squad_id: squadId, plan_id: plan.id } }));
        await sb().from('notifications').insert(notifs);
      }
      return res.status(201).json({ plan });
    }

    const squadDetailMatch = url.match(/^\/squads\/([^/]+)$/);
    const squadActionMatch = url.match(/^\/squads\/([^/]+)\/(join|leave|invite)$/);

    // POST /squads/:id/join
    if (squadActionMatch && squadActionMatch[2] === 'join' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { data: squad } = await sb().from('squads').select('id, is_public, member_count').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      if (!squad.is_public) return res.status(403).json({ error: 'Squad is private' });
      const { error } = await sbAs(token).from('squad_members').insert({ squad_id: squadId, user_id: auth.user.id, role: 'member' });
      if (error) return res.status(400).json({ error: error.message });
      await sb().from('squads').update({ member_count: squad.member_count + 1 }).eq('id', squadId);
      return res.status(200).json({ ok: true });
    }

    // POST /squads/:id/leave
    if (squadActionMatch && squadActionMatch[2] === 'leave' && req.method === 'POST') {
      const token = tokenFrom(req);
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { data: squad } = await sb().from('squads').select('id, member_count, creator_id').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      await sbAs(token).from('squad_members').delete().eq('squad_id', squadId).eq('user_id', auth.user.id);
      const newCount = Math.max(0, squad.member_count - 1);
      if (newCount === 0) {
        await sb().from('squads').delete().eq('id', squadId);
      } else {
        await sb().from('squads').update({ member_count: newCount }).eq('id', squadId);
        if (squad.creator_id === auth.user.id) {
          const { data: nextAdmin } = await sb().from('squad_members').select('user_id').eq('squad_id', squadId).limit(1).single();
          if (nextAdmin) await sb().from('squad_members').update({ role: 'admin' }).eq('squad_id', squadId).eq('user_id', nextAdmin.user_id);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // POST /squads/:id/invite — send invite via SECURITY DEFINER RPC (bypasses grants/RLS)
    if (squadActionMatch && squadActionMatch[2] === 'invite' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadActionMatch[1];
      const { user_id: inviteeId } = req.body || {};
      if (!inviteeId) return res.status(400).json({ error: 'user_id required' });
      // insert_squad_invite is SECURITY DEFINER (runs as postgres) and idempotent —
      // returns {status:'created'|'already_invited'|'already_member'}.
      const { data: rpcResult, error } = await sb().rpc('insert_squad_invite', {
        p_squad_id: squadId,
        p_inviter_id: auth.user.id,
        p_invitee_id: inviteeId,
      });
      if (error) {
        if (error.message?.includes('Not a squad member')) return res.status(403).json({ error: 'Not a squad member' });
        return res.status(400).json({ error: error.message });
      }
      const status = rpcResult?.status || 'created';
      if (status === 'already_member') return res.status(200).json({ ok: true, status: 'already_member', message: 'Already in squad' });
      if (status === 'already_invited') return res.status(200).json({ ok: true, status: 'already_invited', message: 'Already invited' });
      const [{ data: squad }, { data: inviter }] = await Promise.all([
        sb().from('squads').select('name').eq('id', squadId).single(),
        sb().from('profiles').select('display_name').eq('id', auth.user.id).single(),
      ]);
      sb().from('notifications').insert({ user_id: inviteeId, type: 'squad_invite', from_user_id: auth.user.id, from_display_name: inviter?.display_name || 'Someone', entity_id: squadId, entity_type: 'squad', message: `${inviter?.display_name || 'Someone'} invited you to join ${squad?.name || 'a squad'}`, data: { squad_id: squadId } }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // PATCH /squads/:id — update squad config (admin only)
    if (squadDetailMatch && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadDetailMatch[1];
      const { data: membership } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!membership || membership.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { name, description, is_public, template_config, avatar_url } = req.body || {};
      const updates = {};
      if (name) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      if (is_public !== undefined) updates.is_public = is_public;
      if (template_config) updates.template_config = template_config;
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;
      const { error } = await sb().from('squads').update(updates).eq('id', squadId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // PATCH /squads/:id/about — admin updates squad description
    if (squadDetailMatch && url.endsWith('/about') && req.method === 'PATCH') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const squadId = squadDetailMatch[1];
      const { data: mem } = await sb().from('squad_members').select('role').eq('squad_id', squadId).eq('user_id', auth.user.id).single();
      if (!mem || mem.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { description } = req.body || {};
      const { error } = await sb().from('squads').update({ description: description || null }).eq('id', squadId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // GET /squads/:id/public — unauthenticated preview for invite landing page
    if (squadDetailMatch && url.endsWith('/public') && req.method === 'GET') {
      const { data } = await sb().from('squads')
        .select('id, name, avatar_url, member_count, is_public')
        .eq('id', squadDetailMatch[1]).single();
      return res.status(data ? 200 : 404).json(data || { error: 'Not found' });
    }

    // GET /squads/:id — squad detail with per-member points
    if (squadDetailMatch && req.method === 'GET') {
      const auth = await authUser(req);
      const squadId = squadDetailMatch[1];
      const { data: squad } = await sb().from('squads').select('id, name, description, avatar_url, is_public, member_count, total_points, template_type, template_config, creator_id, created_at').eq('id', squadId).single();
      if (!squad) return res.status(404).json({ error: 'Squad not found' });
      const [{ data: members }, { data: memberCheck }, { data: allPoints }] = await Promise.all([
        sb().from('squad_members').select('user_id, role, joined_at, profiles(id, display_name, username, avatar_url, is_verified)').eq('squad_id', squadId),
        auth ? sb().from('squad_members').select('user_id').eq('squad_id', squadId).eq('user_id', auth.user.id).maybeSingle() : Promise.resolve({ data: null }),
        sb().from('squad_points').select('user_id, points').eq('squad_id', squadId),
      ]);
      const { data: activity } = await sb().from('squad_activity').select('id, activity_type, description, created_at, profiles(display_name, avatar_url)').eq('squad_id', squadId).order('created_at', { ascending: false }).limit(10);
      const memberPoints = {};
      (allPoints || []).forEach(p => { memberPoints[p.user_id] = (memberPoints[p.user_id] || 0) + p.points; });
      const isMember = !!memberCheck;
      return res.status(200).json({ squad, members: members || [], activity: activity || [], isMember, memberPoints });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    captureError(e, { url });
    return res.status(500).json({ error: e.message });
  }
};
