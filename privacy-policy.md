# Privacy Policy for DNSRator

**Effective Date:** 02.11.2026 (applies to version 2.3.0 and later)

DNSRator is a browser extension that shows the DNS records of the website in your active tab, the real IP address of the server your browser connected to, geolocation information for IP addresses, and whether an IP address appears on common email/abuse blacklists. It is designed for web developers, system administrators, cybersecurity professionals and anyone interested in how DNS works.

This policy explains exactly what data the extension handles, where it is sent, and what is stored on your device.

## Summary

- DNSRator has **no server of its own**. The developer does not receive, collect, store or sell any of your data.
- There is **no analytics, advertising, tracking or cookies**.
- To work, the extension sends **domain names and IP addresses** (never page content, form data, cookies or personal details) to the public third-party services listed below.
- Some data (settings, recently seen server IPs, favorites) is stored **only locally in your browser** and never leaves your device.

## Data the extension accesses

| Data | When | Purpose |
| --- | --- | --- |
| The URL / domain name of the active tab | When you open the DNSRator popup | To look up that domain's DNS records |
| The IP address your browser connected to for each page (main document only) | On every top-level page load, via the `webRequest` API, if "Real Server IP" is enabled | To show the toolbar badge, the on-page IP box and the popup's server IP card |
| IP addresses you type into the IP lookup field | When you run a lookup | To show geolocation and network information |

DNSRator does **not** read page contents, form inputs, passwords, cookies, request or response bodies, or request headers, and it never blocks or modifies network requests.

## Data sent to third-party services

The following requests are made directly from your browser to these services. Each service receives the data listed, along with your IP address and standard browser request information, as with any web request, and handles it under its own privacy policy.

- **Google Public DNS (dns.google):** receives domain names (for DNS record lookups), IP addresses in reverse-DNS form (for PTR / hostname lookups), and IP addresses combined with blacklist zone names (for blacklist checks).
- **DNS blacklist operators** (SpamCop, Barracuda, PSBL, UCEPROTECT, Mailspike, DroneBL, Blocklist.de, 0spam): receive queries for the IP addresses of the site you are viewing. These queries are resolved through Google Public DNS, so the blacklist operators see Google's resolver rather than your IP address.
- **IP geolocation providers:** when you look up an IP address, it is sent to the first provider in the list that answers. The default list is ip-api.com, ipwho.is, ipinfo.io, api.ip.sb, iplocation.net, db-ip.com, ipwhois.app, ipapi.com, freeipapi.com and ipapi.co. You can change this list on the Settings page.
- **Flag image CDNs** (such as flagcdn.com, jsDelivr, cdnjs, GitHub-hosted icon sets, flagsapi.com, geonames.org and flagpedia.net): receive a two-letter country code to load a country flag image.
- **Google Fonts and cdnjs (Cloudflare):** the popup and Settings page load fonts and icon stylesheets from these services.

## Data stored on your device

The following is stored only in your browser's extension storage (`chrome.storage`) or the extension's local storage. It is never transmitted to the developer.

- Your settings: theme, the IP-API endpoint list, Real Server IP options, IP labels ("mnemonics") and the position of the on-page IP box.
- A list of recently visited hostnames and the server IP address each one connected to, with a timestamp. It is limited to the 500 most recent hostnames, and older entries are removed automatically.
- Your favorite domains and recent IP lookup history.
- A temporary cache of IP geolocation results, which is cleared when the browser closes.

You can stop the collection of server IPs at any time by turning off **Real Server IP** on the Settings page. Removing the extension deletes all of the data above.

## On-page IP box

When enabled, a small script runs on web pages to display the server IP box. It only reads DNSRator's own stored settings and the stored server IP for that page's hostname. It does not read or send anything from the page itself.

## Permissions

- **activeTab / tabs:** read the active tab's URL to look up its domain, and update the per-tab badge.
- **webRequest:** read the IP address of the server each page was loaded from (read-only).
- **scripting:** show the on-page IP box in tabs that were already open when the extension was installed or updated.
- **storage:** save the settings and local data described above.
- **Host access to all sites:** needed to observe the server IP on any site and to display the on-page IP box.

## Data sale and sharing

DNSRator does not sell, rent or trade user data. It does not use or transfer data for purposes unrelated to its single purpose, does not use it to determine creditworthiness or for lending purposes, and does not allow humans to read user data. The use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Children

DNSRator is a technical tool and is not directed at children.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. If significant changes are made, we will update the "Effective Date" at the top of this page. Continued use of the extension after an update constitutes acceptance of the revised policy.

## Contact

If you have any questions or concerns about this Privacy Policy, please contact us at: hi@eren.gg
