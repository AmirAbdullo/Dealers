'use strict';

function createConversationsLib(db) {
  function findOrCreateConversation({ buyerId, dealershipId, vehicleId }) {
    const vid =
      vehicleId === null || vehicleId === undefined ? null : Number(vehicleId);

    let existing;
    if (vid == null) {
      existing = db
        .prepare(
          `SELECT * FROM conversations
           WHERE buyer_id = ? AND dealership_id = ? AND vehicle_id IS NULL
           LIMIT 1`
        )
        .get(buyerId, dealershipId);
    } else {
      existing = db
        .prepare(
          `SELECT * FROM conversations
           WHERE buyer_id = ? AND dealership_id = ? AND vehicle_id = ?`
        )
        .get(buyerId, dealershipId, vid);
    }

    if (existing) return existing;

    const result = db
      .prepare(
        `INSERT INTO conversations (buyer_id, dealership_id, vehicle_id)
         VALUES (?, ?, ?)`
      )
      .run(buyerId, dealershipId, vid);

    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
  }

  function getApprovedDealership(dealershipId) {
    return db
      .prepare(
        `SELECT id, business_name, city, state, status
         FROM dealerships WHERE id = ? AND status = 'approved'`
      )
      .get(dealershipId);
  }

  function validateVehicleForDealership(vehicleId, dealershipId) {
    if (vehicleId == null) return { ok: true };
    const v = db
      .prepare(
        `SELECT id, status, dealership_id FROM vehicles WHERE id = ?`
      )
      .get(vehicleId);
    if (!v) return { ok: false, error: 'Vehicle not found' };
    if (v.status !== 'active') return { ok: false, error: 'Vehicle is not available' };
    if (v.dealership_id !== dealershipId) {
      return { ok: false, error: 'Vehicle does not belong to this dealership' };
    }
    return { ok: true };
  }

  function getConversationById(conversationId) {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  }

  function isParticipant(conversation, viewer) {
    if (!conversation || !viewer) return false;
    if (viewer.role === 'buyer') {
      return conversation.buyer_id === viewer.userId;
    }
    if (viewer.role === 'dealer') {
      return conversation.dealership_id === viewer.dealershipId;
    }
    return false;
  }

  function vehicleSummary(vehicleId) {
    if (vehicleId == null) return null;
    const row = db
      .prepare(
        `SELECT v.id, v.year, v.make, v.model, v.price, v.status,
                p.url AS primary_photo_url
         FROM vehicles v
         LEFT JOIN vehicle_photos p ON p.vehicle_id = v.id AND p.is_primary = 1
         WHERE v.id = ?`
      )
      .get(vehicleId);
    if (!row) return null;
    return {
      year: row.year,
      make: row.make,
      model: row.model,
      primary_photo_url: row.primary_photo_url || null,
      price: row.price,
      status: row.status
    };
  }

  function mapConversationListRow(row, viewerRole) {
    const unread =
      viewerRole === 'buyer' ? row.buyer_unread_count : row.dealer_unread_count;

    let otherParty;
    if (viewerRole === 'buyer') {
      otherParty = {
        id: row.dealer_id,
        name: row.dealer_business_name,
        city: row.dealer_city
      };
    } else {
      otherParty = {
        id: row.buyer_user_id,
        name: row.buyer_full_name
      };
    }

    return {
      id: row.id,
      vehicle_id: row.vehicle_id,
      vehicle: vehicleSummary(row.vehicle_id),
      other_party: otherParty,
      last_message_preview: row.last_message_preview,
      last_message_at: row.last_message_at,
      unread_count: unread,
      created_at: row.created_at
    };
  }

  function listConversationsForBuyer(buyerId, limit, offset) {
    const total = db
      .prepare('SELECT COUNT(*) AS c FROM conversations WHERE buyer_id = ?')
      .get(buyerId).c;

    const rows = db
      .prepare(
        `SELECT c.*,
                d.id AS dealer_id, d.business_name AS dealer_business_name, d.city AS dealer_city,
                u.id AS buyer_user_id, u.full_name AS buyer_full_name
         FROM conversations c
         INNER JOIN dealerships d ON d.id = c.dealership_id
         INNER JOIN users u ON u.id = c.buyer_id
         WHERE c.buyer_id = ?
         ORDER BY c.last_message_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(buyerId, limit, offset);

    return {
      total: total,
      conversations: rows.map(function (r) {
        return mapConversationListRow(r, 'buyer');
      })
    };
  }

  function listConversationsForDealer(dealershipId, limit, offset) {
    const total = db
      .prepare('SELECT COUNT(*) AS c FROM conversations WHERE dealership_id = ?')
      .get(dealershipId).c;

    const rows = db
      .prepare(
        `SELECT c.*,
                d.id AS dealer_id, d.business_name AS dealer_business_name, d.city AS dealer_city,
                u.id AS buyer_user_id, u.full_name AS buyer_full_name
         FROM conversations c
         INNER JOIN dealerships d ON d.id = c.dealership_id
         INNER JOIN users u ON u.id = c.buyer_id
         WHERE c.dealership_id = ?
         ORDER BY c.last_message_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(dealershipId, limit, offset);

    return {
      total: total,
      conversations: rows.map(function (r) {
        return mapConversationListRow(r, 'dealer');
      })
    };
  }

  function markConversationRead(conversationId, viewerRole) {
    const now = new Date().toISOString();
    if (viewerRole === 'buyer') {
      db.prepare(
        `UPDATE messages SET read_at = ?
         WHERE conversation_id = ? AND read_at IS NULL
         AND sender_id = (
           SELECT d.user_id FROM dealerships d
           INNER JOIN conversations c ON c.dealership_id = d.id
           WHERE c.id = ?
         )`
      ).run(now, conversationId, conversationId);
      db.prepare('UPDATE conversations SET buyer_unread_count = 0 WHERE id = ?').run(
        conversationId
      );
    } else if (viewerRole === 'dealer') {
      db.prepare(
        `UPDATE messages SET read_at = ?
         WHERE conversation_id = ? AND read_at IS NULL
         AND sender_id = (SELECT buyer_id FROM conversations WHERE id = ?)`
      ).run(now, conversationId, conversationId);
      db.prepare('UPDATE conversations SET dealer_unread_count = 0 WHERE id = ?').run(
        conversationId
      );
    }
  }

  function loadMessages(conversationId, limit, beforeId) {
    let rows;
    if (beforeId) {
      rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ? AND id < ?
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(conversationId, beforeId, limit + 1);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(conversationId, limit + 1);
    }

    const hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    rows.reverse();

    return { messages: rows, has_more: hasMore };
  }

  function enrichMessage(row) {
    const sender = db
      .prepare('SELECT id, full_name, role FROM users WHERE id = ?')
      .get(row.sender_id);
    const attachments = db
      .prepare(
        'SELECT * FROM message_attachments WHERE message_id = ? ORDER BY id ASC'
      )
      .all(row.id);

    return {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      sender: sender
        ? { id: sender.id, full_name: sender.full_name, role: sender.role }
        : null,
      body: row.body,
      has_attachments: row.has_attachments,
      attachments: attachments,
      read_at: row.read_at,
      created_at: row.created_at
    };
  }

  function previewText(body, hasAttachments) {
    const trimmed = body != null ? String(body).trim() : '';
    if (trimmed) return trimmed.slice(0, 100);
    if (hasAttachments) return '📎 Attachment';
    return '';
  }

  function insertMessage({ conversationId, senderId, body, attachments }) {
    const hasAttachments = attachments && attachments.length > 0 ? 1 : 0;
    const bodyVal = body != null && String(body).trim() !== '' ? String(body).trim() : null;

    const info = db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, body, has_attachments)
         VALUES (?, ?, ?, ?)`
      )
      .run(conversationId, senderId, bodyVal, hasAttachments);

    const messageId = info.lastInsertRowid;

    if (hasAttachments) {
      const insertAtt = db.prepare(
        `INSERT INTO message_attachments (
          message_id, url, file_type, mime_type, filename, size_bytes,
          thumbnail_url, width, height, duration_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      attachments.forEach(function (a) {
        insertAtt.run(
          messageId,
          a.url,
          a.file_type,
          a.mime_type || null,
          a.filename || null,
          a.size_bytes != null ? a.size_bytes : null,
          a.thumbnail_url || null,
          a.width != null ? a.width : null,
          a.height != null ? a.height : null,
          a.duration_seconds != null ? a.duration_seconds : null
        );
      });
    }

    const preview = previewText(bodyVal, hasAttachments);
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    const sender = db.prepare('SELECT role FROM users WHERE id = ?').get(senderId);

    if (sender.role === 'buyer') {
      db.prepare(
        `UPDATE conversations SET
          last_message_at = CURRENT_TIMESTAMP,
          last_message_preview = ?,
          updated_at = CURRENT_TIMESTAMP,
          dealer_unread_count = dealer_unread_count + 1
         WHERE id = ?`
      ).run(preview, conversationId);
    } else {
      db.prepare(
        `UPDATE conversations SET
          last_message_at = CURRENT_TIMESTAMP,
          last_message_preview = ?,
          updated_at = CURRENT_TIMESTAMP,
          buyer_unread_count = buyer_unread_count + 1
         WHERE id = ?`
      ).run(preview, conversationId);
    }

    return enrichMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId));
  }

  function unreadSummaryForBuyer(buyerId) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(buyer_unread_count), 0) AS total,
                COUNT(CASE WHEN buyer_unread_count > 0 THEN 1 END) AS conv_count
         FROM conversations WHERE buyer_id = ?`
      )
      .get(buyerId);
    return {
      total_unread: row.total,
      conversation_count_with_unread: row.conv_count
    };
  }

  function unreadSummaryForDealer(dealershipId) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(dealer_unread_count), 0) AS total,
                COUNT(CASE WHEN dealer_unread_count > 0 THEN 1 END) AS conv_count
         FROM conversations WHERE dealership_id = ?`
      )
      .get(dealershipId);
    return {
      total_unread: row.total,
      conversation_count_with_unread: row.conv_count
    };
  }

  return {
    findOrCreateConversation,
    getApprovedDealership,
    validateVehicleForDealership,
    getConversationById,
    isParticipant,
    listConversationsForBuyer,
    listConversationsForDealer,
    markConversationRead,
    loadMessages,
    enrichMessage,
    insertMessage,
    unreadSummaryForBuyer,
    unreadSummaryForDealer
  };
}

module.exports = createConversationsLib;
