-- One-time backfill: event-posts (auto-created when an organizer publishes an
-- event) were saved with a NULL image_url and relied on the feed to enrich the
-- image from the linked event at render time. That enrichment fails once the
-- event is past (RLS hides it from the anon client), so recent organizer posts
-- showed no picture. Copy the event's image onto the post so the feed renders
-- it directly. Going forward, /api/posts stores image_url at creation time.

UPDATE posts p
SET image_url = e.image_url
FROM events e
WHERE p.event_id = e.id
  AND (p.image_url IS NULL OR p.image_url = '')
  AND e.image_url IS NOT NULL
  AND e.image_url <> '';
