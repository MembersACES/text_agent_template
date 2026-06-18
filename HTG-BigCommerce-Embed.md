Honest to Goodness – Sandbox Chat Widget Setup
This guide shows you how to add the support chat widget to your BigCommerce sandbox store using Script Manager.

The widget appears in the bottom-right corner. It **starts as a small launcher**; shoppers tap it to open the full chat. The script resizes the iframe when the panel opens or minimises.

1. Open Script Manager
Log in to your BigCommerce sandbox admin.

In the left menu, go to Storefront → Script Manager.

If the **Honest To Goodness Chat Widget** script already exists (it does on the current sandbox), open it and go straight to step 3 — you will replace the contents of the Script field, not add a second script. If you are setting it up fresh, click **Create a Script**.

2. Script settings
In the script configuration screen, set:

Name: Honest To Goodness Chat Widget

Description: Support chat widget for sandbox testing (optional)

Location on page: Footer

Select pages where script will be added: All pages

Script type: Script

Script category: any category is fine (for example, Essential)

3. Paste (or replace) the script
Clear anything already in the Script field, then paste this snippet exactly (it listens for resize messages from the widget so the iframe matches the launcher's size and position until chat is opened — this keeps the collapsed widget from covering page buttons such as the cart's **Checkout**):

```html
<script>
  (function() {
    // Collapsed = just the launcher circle. Lifted off the bottom edge so it doesn't
    // sit on top of the store's cart-drawer Checkout button. Open = full chat panel.
    var COLLAPSED_W = 96, COLLAPSED_H = 88, COLLAPSED_BOTTOM = '100px';
    var EXPANDED_W = 380, EXPANDED_H = 640, EXPANDED_BOTTOM = '20px';
    var MSG_SOURCE = 'htg-chat-widget';
    var iframe = document.createElement('iframe');
    iframe.id = 'htg-chat-widget-iframe';
    iframe.src = 'https://aces-honest-to-goodness-agent-672026052958.australia-southeast2.run.app/chat-widget?agentId=honest-to-goodness-agent';
    iframe.style.position = 'fixed';
    iframe.style.bottom = COLLAPSED_BOTTOM;
    iframe.style.right = '20px';
    iframe.style.width = COLLAPSED_W + 'px';
    iframe.style.height = COLLAPSED_H + 'px';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.zIndex = '9999';
    iframe.setAttribute('title', 'Honest to Goodness support chat');
    iframe.loading = 'lazy';
    iframe.allow = 'clipboard-write';
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.source !== MSG_SOURCE) return;
      // Prefer the explicit flag; fall back to inferring from height for older widget builds.
      var isExpanded = (typeof d.expanded === 'boolean')
        ? d.expanded
        : (typeof d.heightPx === 'number' && d.heightPx > COLLAPSED_H);
      iframe.style.height = (typeof d.heightPx === 'number' ? d.heightPx : (isExpanded ? EXPANDED_H : COLLAPSED_H)) + 'px';
      iframe.style.width  = (typeof d.widthPx === 'number' ? d.widthPx : (isExpanded ? EXPANDED_W : COLLAPSED_W)) + 'px';
      iframe.style.bottom = isExpanded ? EXPANDED_BOTTOM : COLLAPSED_BOTTOM;
    });
    document.body.appendChild(iframe);
  })();
</script>
```

Click Save.

**Optional:** append `&open=1` to the iframe `src` URL if you need the panel open by default for testing (for example `...chat-widget?agentId=honest-to-goodness-agent&open=1`).

4. Verify on sandbox
Open https://sandbox-honest-to-goodness.mybigcommerce.com/ in a new browser tab.

Refresh the page.

You should see the round launcher in the bottom-right. After you click it, the chat panel should expand and the iframe should grow with it.

Important — confirm the checkout fix: add an item to the cart, open the cart drawer, and check that you can click **Checkout** while the launcher is showing. It should no longer be blocked.

If you don’t see it:

Hard refresh the page (Ctrl+F5 / Cmd+Shift+R).

Temporarily disable any ad/script blockers for the site.

In Script Manager, confirm the script is enabled and set to Footer on All pages.

5. How to remove or disable the widget
If you want to turn the widget off:

Go back to Storefront → Script Manager.

Open the Honest To Goodness Chat Widget script.

Either disable it or delete the script, then save.
