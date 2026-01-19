# WebSocket & Socket.IO Integration

Real-time communication between the Frappe backend and React frontend using Socket.IO.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                                                                          │
│  ┌──────────────────┐     ┌─────────────────────┐     ┌───────────────┐ │
│  │ FrappeProvider   │────▶│ SocketInitializer   │────▶│ Zustand       │ │
│  │ (socket context) │     │ (global listeners)  │     │ Stores        │ │
│  └──────────────────┘     └─────────────────────┘     └───────────────┘ │
│                                     │                                    │
│                                     ▼                                    │
│                          ┌─────────────────────┐                        │
│                          │ socketListeners.ts  │                        │
│                          │ (event routing)     │                        │
│                          └─────────────────────┘                        │
│                                     │                                    │
│                                     ▼                                    │
│                          ┌─────────────────────┐                        │
│                          │ eventListeners.ts   │                        │
│                          │ (notification logic)│                        │
│                          └─────────────────────┘                        │
│                                                                          │
└───────────────────────────────────────────────────────────────────────────┘
                                      │
                           WebSocket via Proxy
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│                                                                          │
│  Frappe Backend (port 8000)  ◄────────▶  Socket.IO Server (port 9000)   │
│                                                                          │
│  frappe.publish_realtime(event, message, user)                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `proxyOptions.ts` | Vite dev proxy config for Socket.IO |
| `src/config/SocketInitializer.tsx` | Initializes global socket listeners on app mount |
| `src/services/socketListeners.ts` | Registers all event handlers, returns cleanup function |
| `src/zustand/eventListeners.ts` | Event handler implementations (fetch + add notification) |
| `src/zustand/useNotificationStore.ts` | Zustand store for notification state |

---

## Development Proxy Setup

**File:** `proxyOptions.ts`

```typescript
// Socket.IO proxy (separate from API proxy)
'^/socket.io': {
  target: `http://127.0.0.1:${socketio_port}`, // Default: 9000
  ws: true,        // CRITICAL: Enable WebSocket proxying
  changeOrigin: true,
  secure: false,
  onProxyReqWs: (proxyReq, req, socket, options, head) => {
    // Pass site name for Frappe multi-tenancy
    proxyReq.setHeader('X-Frappe-Site-Name', targetSite);
  }
}
```

**Ports:**
- Frappe backend: `8000` (from `common_site_config.json` or default)
- Socket.IO: `9000` (from `common_site_config.json` or default)
- Frontend dev: `8080`

---

## Event Naming Convention

**Pattern:** `{doctype}:{action}`

| Event | Doctype | Action |
|-------|---------|--------|
| `pr:new` | Procurement Request | Created |
| `pr:delete` | Procurement Request | Deleted |
| `pr:approved` | Procurement Request | Approved |
| `pr:rejected` | Procurement Request | Rejected |
| `pr:vendorSelected` | Procurement Request | Vendor selected |
| `po:new` | Procurement Order | Created |
| `po:amended` | Procurement Order | Amended |
| `po:delete` | Procurement Order | Deleted |
| `sr:approved` | Service Request | Approved |
| `sr:vendorSelected` | Service Request | Vendor selected |
| `sr:amended` | Service Request | Amended |
| `sr:delete` | Service Request | Deleted |
| `sb:vendorSelected` | Sent Back | Vendor selected |
| `Rejected-sb:new` | Sent Back | Rejected |
| `Delayed-sb:new` | Sent Back | Delayed |
| `Cancelled-sb:new` | Sent Back | Cancelled |
| `payment:new` | Payment | Created |
| `payment:approved` | Payment | Approved |
| `payment:fulfilled` | Payment | Fulfilled |
| `payment:delete` | Payment | Deleted |

---

## Backend Event Publishing

**Pattern:** Always `frappe.db.commit()` BEFORE `publish_realtime()` to avoid race conditions.

```python
# In nirmaan_stack/integrations/controllers/*.py

# 1. Create notification document
notification = frappe.get_doc({
    "doctype": "Nirmaan Notifications",
    "recipient": user['name'],
    "title": "New PR Created",
    ...
})
notification.insert()

# 2. COMMIT first (critical!)
frappe.db.commit()

# 3. Then publish event
frappe.publish_realtime(
    event="pr:new",
    message={"notificationId": notification.name},
    user=user['name']  # Target specific user
)
```

**Important:** The `user` parameter in `publish_realtime()` targets the event to that specific user's socket connection.

---

## Frontend Event Handling Flow

### 1. SocketInitializer (app mount)

**File:** `src/config/SocketInitializer.tsx`

```tsx
const { socket, db } = useContext(FrappeContext);
const notificationStore = useNotificationStore();

useEffect(() => {
  if (socket && db && !initialized.current) {
    const cleanup = initializeSocketListeners({
      socket,
      db,
      notificationActions: {
        add_new_notification: notificationStore.add_new_notification,
        delete_notification: notificationStore.delete_notification,
      },
    });
    initialized.current = true;
    return cleanup;
  }
}, [socket, db, notificationStore]);
```

### 2. Socket Listeners Registration

**File:** `src/services/socketListeners.ts`

```typescript
export const initializeSocketListeners = ({
  socket, db, notificationActions
}): (() => void) => {

  // Safe handler wrapper for async operations
  const safeHandler = (handler) => async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`Socket event handler error:`, error);
    }
  };

  // Register listeners
  socket.on("pr:new", safeHandler(async (event) =>
    handlePRNewEvent(db, event, notificationActions.add_new_notification)
  ));

  // ... more listeners

  // Return cleanup function
  return () => {
    socket.off("pr:new", ...);
    // ... remove all listeners
  };
};
```

### 3. Event Handlers

**File:** `src/zustand/eventListeners.ts`

```typescript
// Generic handler - fetches notification doc and adds to store
async function handleNotification(db, event, add_new_notification) {
  if (event?.notificationId) {
    const notificationData = await db.getDoc("Nirmaan Notifications", event.notificationId);
    if (notificationData) {
      add_new_notification({
        name: notificationData.name,
        title: notificationData.title,
        seen: notificationData.seen === 1 ? "true" : "false",
        // ... map all fields
      });
    }
  }
}

export const handlePRNewEvent = async (db, event, add_new_notification) => {
  await handleNotification(db, event, add_new_notification);
};
```

---

## Notification Store

**File:** `src/zustand/useNotificationStore.ts`

```typescript
interface NotificationType {
  name: string;
  creation: string;
  title: string;
  description: string;
  docname: string;
  document: string;
  event_id: string;
  project: string;
  recipient: string;
  recipient_role: string;
  seen: "true" | "false";
  sender: string | null;
  type: string;
  work_package: string;
  action_url?: string | null;
}

// Persisted to sessionStorage
const useNotificationStore = create(
  persist(
    (set, get) => ({
      notifications: [],
      notificationsCount: 0,

      add_new_notification: (notification) => {
        // Deduplication check
        if (!get().notifications.some(n => n.name === notification.name)) {
          set((state) => ({
            notifications: [notification, ...state.notifications],
            notificationsCount: state.notificationsCount +
              (notification.seen === "false" ? 1 : 0),
          }));
        }
      },

      mark_seen_notification: async (db, notification) => {
        // Optimistic update, then DB call
      },

      delete_notification: (id) => { ... },
    }),
    { name: 'notifications', storage: sessionStorage }
  )
);
```

---

## Adding a New Event Type

### Backend (Python)

1. **In the relevant controller** (e.g., `integrations/controllers/my_doctype.py`):

```python
def after_insert(doc, method):
    # Create notification
    notification = frappe.get_doc({
        "doctype": "Nirmaan Notifications",
        "recipient": target_user,
        "title": "New Document Created",
        "document": doc.doctype,
        "docname": doc.name,
        ...
    })
    notification.insert()

    frappe.db.commit()  # ALWAYS commit before publish_realtime

    frappe.publish_realtime(
        event="mydoc:new",
        message={"notificationId": notification.name},
        user=target_user
    )
```

### Frontend (TypeScript)

1. **Add handler** in `src/zustand/eventListeners.ts`:

```typescript
export const handleMyDocNewEvent = async (db, event, add_new_notification) => {
  await handleNotification(db, event, add_new_notification);
};
```

2. **Register listener** in `src/services/socketListeners.ts`:

```typescript
// In initializeSocketListeners():
const onMyDocNew = safeHandler(async (event) =>
  handleMyDocNewEvent(db, event, notificationActions.add_new_notification)
);
socket.on("mydoc:new", onMyDocNew);

// In cleanup function:
socket.off("mydoc:new", onMyDocNew);
```

---

## Debugging Tips

### Browser Console

```javascript
// Check socket connection status
// In React DevTools or console:
socket.connected  // should be true
socket.id         // connection ID

// Manual event subscription for testing
socket.on("pr:new", (data) => console.log("PR event:", data));
```

### Backend

```python
# Check if Socket.IO server is running
bench --site localhost socketio

# Test publish_realtime in console
bench --site localhost console
>>> frappe.publish_realtime("test:event", {"foo": "bar"}, user="test@example.com")
```

### Common Issues

1. **Events not received:**
   - Check `user` parameter in `publish_realtime()` matches the logged-in user
   - Ensure `frappe.db.commit()` is called before `publish_realtime()`
   - Verify Socket.IO proxy is configured correctly in dev

2. **Race condition (notification not found):**
   - Missing `frappe.db.commit()` before `publish_realtime()`
   - Frontend fetches doc before it's committed to DB

3. **Duplicate notifications:**
   - Store already checks for duplicates by `name`
   - If seeing duplicates, check if events are being registered multiple times

---

## Related Documentation

- Backend integrations: `../../../CLAUDE.md` (Real-time Events section)
- Backend controllers: `../../../.claude/context/integrations.md`
- Notification doctype: `../../../.claude/context/doctypes.md`
