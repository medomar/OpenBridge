# WebChat Manual Test Checklist

> Manual QA tests for WebChat features (Phases 88–92).
> Run `npm run build && npm run dev`, then open the WebChat URL from the console.

---

## Phase 88 — UI Basics

- [ ] Page loads without raw JS/errors in the browser console
- [ ] Dark mode toggle works (header button)
- [ ] Dark theme persists after page refresh (localStorage)
- [ ] Send a message — appears in chat as user bubble with avatar
- [ ] AI response renders markdown (bold, lists, links, tables)
- [ ] Code blocks have syntax highlighting (try: "write a hello world in Python")
- [ ] Copy button on code blocks copies to clipboard, shows "Copied!" for 2s
- [ ] Long AI responses (>500 chars) collapse with "Show more" / "Show less"
- [ ] Message timestamps show relative time ("2m ago")
- [ ] Hover on timestamp shows absolute date/time
- [ ] Tab key cycles through interactive elements
- [ ] Enter sends message, Escape clears input
- [ ] User and AI bubbles have distinct avatars and colors

## Phase 89 — Authentication

### Token Auth (default)

- [ ] Console prints WebChat URL with `?token=...`
- [ ] Opening URL with valid token shows the chat UI
- [ ] Opening URL without token returns 401
- [ ] Opening URL with wrong token returns 401
- [ ] Token persists across restarts (stored in `.openbridge/webchat-token`)

### Password Auth

- [ ] Set `password` in webchat config options
- [ ] Opening URL shows login screen instead of chat
- [ ] Correct password logs in and redirects to chat
- [ ] Wrong password shows error message
- [ ] After login, refreshing page stays logged in (session cookie, 24h)
- [ ] Rate limit: enter wrong password 5 times in 15 min — get 429 response
- [ ] Rate limit block lasts 30 minutes

### WebSocket Auth

- [ ] WebSocket connection without valid token is rejected (no messages received)
- [ ] WebSocket connection with valid token works normally

## Phase 90 — Phone / Mobile / PWA

### LAN Access

- [ ] Console prints LAN IP URLs (e.g., `http://192.168.x.x:3000/?token=...`)
- [ ] QR code displayed in console terminal
- [ ] Scan QR code with phone — opens WebChat on phone (same WiFi)
- [ ] "Share" button in header copies URL to clipboard, shows "Link copied!" toast

### Responsive Layout

- [ ] Desktop (>768px): centered card with shadow, padding around edges
- [ ] Mobile (<768px): full-width, no border-radius, no shadow
- [ ] Landscape mobile: reduced padding, compact header
- [ ] iPhone: no overlap with notch/Dynamic Island (safe area insets)
- [ ] iPhone: no overlap with home indicator at bottom

### Touch / Mobile UX

- [ ] All buttons are at least 44px tap targets on mobile
- [ ] Send button is easy to tap (larger padding on mobile)
- [ ] Input field has 16px font (no iOS auto-zoom on focus)
- [ ] No accidental text selection on buttons

### PWA

- [ ] "Add to Home Screen" banner appears on first mobile visit
- [ ] Dismissing the banner permanently hides it
- [ ] On Android/Chrome: "Add" button triggers native install prompt
- [ ] On iOS Safari: shows manual instructions (Share > Add to Home Screen)
- [ ] After installing PWA: app opens in standalone mode (no browser chrome)
- [ ] Service worker registered (check DevTools > Application > Service Workers)
- [ ] Offline: shows cached HTML shell with "Reconnecting..." message

### Notifications

- [ ] Browser notification permission requested after 3s delay
- [ ] Switch to another tab, send a message — browser notification appears
- [ ] Tab title shows unread count: "(3) OpenBridge" when unfocused
- [ ] Switching back to tab resets unread count to "OpenBridge"
- [ ] Sound plays on AI response (speaker icon in header)
- [ ] Mute toggle: click speaker icon — sound stops, icon changes
- [ ] Mute preference persists after refresh (localStorage)

## Phase 91 — Conversation History + Rich Input

### Sidebar

- [ ] Hamburger menu (top-left) opens sidebar
- [ ] Desktop: sidebar auto-opens on first visit
- [ ] Mobile: sidebar opens as overlay with dark backdrop
- [ ] Escape key closes sidebar on mobile
- [ ] Clicking overlay closes sidebar on mobile
- [ ] Desktop: sidebar state (open/closed) persists after refresh

### Session List

- [ ] Past conversations listed with title, date, message count
- [ ] Most recent session at the top
- [ ] Click a session — loads its transcript in the chat area
- [ ] Active session highlighted with blue tint
- [ ] "+" button starts a new conversation (clears chat, sends new-session)
- [ ] Empty state: "No conversations yet." when no history

### Search

- [ ] Type in sidebar search — results appear after 300ms debounce
- [ ] Search results show snippet with matched terms highlighted
- [ ] Click a search result — loads that session transcript
- [ ] Clear search — returns to session list

### Conversation Persistence

- [ ] Refresh the page — current conversation restored from localStorage
- [ ] Starting new conversation clears localStorage
- [ ] Loading a past session replaces localStorage content

### Textarea Input

- [ ] Input is a textarea (not single-line input)
- [ ] Shift+Enter inserts newline
- [ ] Enter (without Shift) sends the message
- [ ] Textarea auto-resizes up to 6 lines, then scrolls
- [ ] Character count appears after 500 characters
- [ ] Escape clears the textarea

### File Upload

- [ ] Paperclip button opens file picker
- [ ] Selected files show as chips with name, size, remove button
- [ ] Drag-and-drop files onto chat area works
- [ ] Sending with files uploads to `/api/upload`, paths appended to message
- [ ] Files stored in `.openbridge/uploads/`
- [ ] 10MB file size limit enforced (try uploading >10MB file)

### Voice Input

- [ ] Microphone button visible (hidden if no MediaRecorder support)
- [ ] Click mic — browser asks for microphone permission
- [ ] Recording: mic button turns red, pulsing indicator shown
- [ ] Click again to stop — audio sent to `/api/transcribe`
- [ ] Transcribed text inserted into textarea for review before sending
- [ ] Mic button disabled when WebSocket disconnected

### Slash Commands

- [ ] Type `/` — autocomplete dropdown appears
- [ ] Arrow keys navigate suggestions, Enter/Tab selects
- [ ] Escape closes dropdown
- [ ] Commands fetched from server (`/api/commands`), fallback to built-in list
- [ ] Selected command + space inserted into textarea

### Feedback

- [ ] Each AI response has thumbs up/down buttons below it
- [ ] Clicking a thumb disables both buttons (no double-vote)
- [ ] "Thanks!" toast shown for 2 seconds
- [ ] Feedback sent to `/api/feedback`

## Phase 92 — Settings Panel + Deep Mode UI

### Settings Panel

- [ ] Gear icon in header opens settings panel (slides from right)
- [ ] Escape or clicking overlay closes it
- [ ] AI tool selector shows discovered tools from `/api/discovery`
- [ ] Execution profile: fast / thorough / manual radio buttons
- [ ] Profile persists in localStorage and syncs to server via PUT
- [ ] Sound checkbox syncs with header speaker toggle (bidirectional)
- [ ] Browser notifications checkbox requests permission if needed
- [ ] Theme selector syncs with header dark/light toggle (bidirectional)

### Deep Mode UI

- [ ] Send `/deep` command — stepper bar appears with 5 phase dots
- [ ] Current phase dot is highlighted (filled circle)
- [ ] Completed phases show checkmark
- [ ] Phase transition cards appear in chat with icon, name, status
- [ ] Long phase summaries are collapsible (Show more / Show less)
- [ ] After verify phase completes, stepper bar auto-hides after 3s

---

## Known Issues / Bugs Found

- [x] **Build script `$&` bug** — `String.prototype.replace()` in `build-webchat-ui.js` interpreted `$&` in minified JS as a special pattern, injecting raw `</script>` mid-JS. Fixed: switched to `indexOf/slice` concatenation.

---

## Test Environment Notes

- **Desktop**: Chrome, Firefox, Safari (latest)
- **Mobile**: iOS Safari, Android Chrome
- **Network**: Desktop and phone on same WiFi for LAN tests
- **Config**: Test both token auth (default) and password auth modes
