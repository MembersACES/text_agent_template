Those tweaks from Cursor are all good polish and align with what you want.

Here’s the slightly refined client doc text incorporating them:

Honest to Goodness – Sandbox Chat Widget Setup
This guide shows you how to add the support chat widget to your BigCommerce sandbox store using Script Manager.

The widget will appear as a small panel in the bottom-right corner of every page on the sandbox site.

1. Open Script Manager
Log in to your BigCommerce sandbox admin.

In the left menu, go to Storefront → Script Manager.

Click Create a Script.

2. Script settings
In the script configuration screen, set:

Name: Honest to Goodness Chat Widget

Description: Support chat widget for sandbox testing (optional)

Location on page: Footer

Select pages where script will be added: All pages

Script type: Script

Script category: any category is fine (for example, Essential)

3. Paste the script
In the Script field, paste this snippet exactly:

xml
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
    iframe.loading = 'lazy';
    iframe.allow = 'clipboard-write';
    document.body.appendChild(iframe);
  })();
</script>
Click Save.

4. Verify on sandbox
Open https://sandbox-honest-to-goodness.mybigcommerce.com/ in a new browser tab.

Refresh the page.

You should see the “Honest to Goodness support chat” widget in the bottom-right corner.

If you don’t see it:

Hard refresh the page (Ctrl+F5 / Cmd+Shift+R).

Temporarily disable any ad/script blockers for the site.

In Script Manager, confirm the script is enabled and set to Footer on All pages.

5. How to remove or disable the widget
If you want to turn the widget off:

Go back to Storefront → Script Manager.

Open the Honest to Goodness Chat Widget script.

Either disable it or delete the script, then save.