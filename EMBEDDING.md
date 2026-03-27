# Embedding Guide

This document explains how to embed the Text Agent interface into other applications.

## Option 1: Iframe Embedding (Simplest)

The easiest way to embed the entire application is using an iframe. This works for any website or application.

**Note:** The application has been configured to allow iframe embedding via `Content-Security-Policy: frame-ancestors *` in `next.config.ts`.

### Basic Iframe - Full Application

```html
<iframe 
  src="https://your-domain.com" 
  width="100%" 
  height="800px" 
  frameborder="0"
  allow="clipboard-read; clipboard-write"
></iframe>
```

### Basic Iframe - Chat Widget Only

```html
<iframe 
  src="https://your-domain.com/chat-widget?agentId=honest-to-goodness-agent" 
  width="100%" 
  height="600px" 
  frameborder="0"
  allow="clipboard-read; clipboard-write"
></iframe>
```

### Responsive Iframe with Styling

```html
<div style="position: relative; width: 100%; height: 0; padding-bottom: 75%;">
  <iframe 
    src="https://your-domain.com" 
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"
    allow="clipboard-read; clipboard-write"
  ></iframe>
</div>
```

### React Component Example

```tsx
export function EmbeddedTextAgent({ url = 'https://your-domain.com' }) {
  return (
    <div className="w-full h-[800px] border border-gray-200 rounded-lg overflow-hidden">
      <iframe 
        src={url}
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
        title="Text Agent"
      />
    </div>
  );
}
```

## Option 2: Chat-Only Widget Mode

If you only want to embed the chat interface (without the prompt editor), you can create a chat-only page.

### Create a Chat-Only Route

The `chat-widget` route is available without session pre-auth and accepts an `agentId` query param:

```tsx
https://your-domain.com/chat-widget?agentId=honest-to-goodness-agent
```

Then embed just the chat:

```html
<iframe 
  src="https://your-domain.com/chat-widget?agentId=honest-to-goodness-agent" 
  width="100%" 
  height="600px"
  frameborder="0"
></iframe>
```

## Option 3: Component Export (Next.js Only)

If you want to use the components directly in another Next.js application:

### Export Components

1. Make components exportable from a shared location
2. Import in your other Next.js app:

```tsx
import ChatWindow from '@your-package/components/ChatWindow';
import PromptEditor from '@your-package/components/PromptEditor';

export default function MyPage() {
  return (
    <div className="flex h-screen">
      <div className="w-1/2">
        <PromptEditor />
      </div>
      <div className="w-1/2">
        <ChatWindow />
      </div>
    </div>
  );
}
```

## Option 4: Standalone Widget Script

For maximum flexibility, you can embed a fixed widget via a script tag.

### Create Widget Script

Create `public/widget.js`:

```javascript
(function() {
  const widgetId = 'text-agent-widget-' + Date.now();
  const container = document.createElement('div');
  container.id = widgetId;
  container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; width: min(380px, calc(100vw - 24px)); height: min(640px, calc(100vh - 24px)); z-index: 9999; border: none; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border-radius: 12px; overflow: hidden;';
  
  const iframe = document.createElement('iframe');
  iframe.src = 'https://your-domain.com/chat-widget?agentId=honest-to-goodness-agent';
  iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: transparent;';
  iframe.title = 'Support chat';
  iframe.loading = 'lazy';
  iframe.allow = 'clipboard-write';
  container.appendChild(iframe);
  
  document.body.appendChild(container);
})();
```

### Usage

```html
<script src="https://your-domain.com/widget.js"></script>
```

## Security Considerations

1. **CORS**: If embedding via iframe, ensure your server allows iframe embedding:
   - Remove or configure `X-Frame-Options` header
   - Consider using `Content-Security-Policy: frame-ancestors`

2. **Authentication**: `chat-widget` is designed for public embedding. Keep the main workspace routes (`/`, `/agent/[agentId]`, `/htg-agent`) behind auth.
   - If you need to lock embed access, add server-side validation on the widget route or API requests.
   - Avoid exposing admin/editor routes to external iframes.

3. **API Routes**: Ensure your API routes are accessible from the embedded context.

## BigCommerce Script Manager

For sandbox deployment, use Script Manager with:

- Location: `Footer`
- Pages: `All pages`

Path: `Storefront -> Script Manager -> Create a Script`

Paste this snippet as-is:

```html
<script>
  (function() {
    var iframe = document.createElement('iframe');
    iframe.src = 'https://aces-honest-to-goodness-agent-672026052958.australia-southeast2.run.app/chat-widget?agentId=honest-to-goodness-agent';
    iframe.style.position = 'fixed';
    iframe.style.bottom = '20px';
    iframe.style.right = '20px';
    iframe.style.width = '380px';
    iframe.style.height = '640px';
    iframe.style.border = '0';
    iframe.style.zIndex = '9999';
    iframe.setAttribute('title', 'Honest to Goodness support chat');
    document.body.appendChild(iframe);
  })();
</script>
```

## Customization

### Hide Header/Footer

Create a minimal layout by modifying the page component or creating a new route that omits headers/footers.

### Custom Styling

You can pass custom styles via URL parameters or use CSS to override styles in the iframe (if same-origin).

## Example: Full Page Embed

```html
<!DOCTYPE html>
<html>
<head>
  <title>My App with Embedded Text Agent</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    .container { display: flex; height: 100vh; }
    .sidebar { width: 300px; background: #f5f5f5; padding: 20px; }
    .content { flex: 1; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <h2>My App</h2>
      <p>Other content here...</p>
    </div>
    <div class="content">
      <iframe src="https://your-domain.com"></iframe>
    </div>
  </div>
</body>
</html>
```

