/**
 * Unified Notifications Client
 * Syncs notifications across all platforms using Supabase real-time
 */

import { createClient } from '@supabase/supabase-js';

export class NotificationsClient {
  constructor(supabaseUrl, supabaseAnonKey, authToken) {
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    });
    this.channel = null;
    this.listeners = new Set();
  }

  /**
   * Subscribe to real-time notifications
   */
  async subscribe(userId, callback) {
    if (this.channel) {
      this.unsubscribe();
    }

    this.channel = this.client
      .channel(`notifications:${userId}`)
      .on('broadcast', { event: 'notification_created' }, (payload) => {
        this.notifyListeners('created', payload.payload);
      })
      .on('broadcast', { event: 'notification_updated' }, (payload) => {
        this.notifyListeners('updated', payload.payload);
      })
      .on('broadcast', { event: 'notification_deleted' }, (payload) => {
        this.notifyListeners('deleted', payload.payload);
      })
      .subscribe();

    if (callback) {
      this.listeners.add(callback);
    }

    return this;
  }

  /**
   * Unsubscribe from real-time notifications
   */
  unsubscribe() {
    if (this.channel) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.listeners.clear();
  }

  /**
   * Add event listener
   */
  on(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (e) {
        console.error('Notification listener error:', e);
      }
    });
  }

  /**
   * Fetch all notifications
   */
  async getAll() {
    const response = await fetch('/api/notifications', {
      headers: {
        'Authorization': this.client.auth.headers?.Authorization || ''
      }
    });
    if (!response.ok) throw new Error('Failed to fetch notifications');
    return response.json();
  }

  /**
   * Create a new notification
   */
  async create(notification) {
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.client.auth.headers?.Authorization || ''
      },
      body: JSON.stringify(notification)
    });
    if (!response.ok) throw new Error('Failed to create notification');
    return response.json();
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id) {
    const response = await fetch('/api/notifications', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.client.auth.headers?.Authorization || ''
      },
      body: JSON.stringify({ id, read: true })
    });
    if (!response.ok) throw new Error('Failed to update notification');
    return response.json();
  }

  /**
   * Delete notification
   */
  async delete(id) {
    const response = await fetch('/api/notifications', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.client.auth.headers?.Authorization || ''
      },
      body: JSON.stringify({ id })
    });
    if (!response.ok) throw new Error('Failed to delete notification');
    return response.json();
  }
}

export default NotificationsClient;
