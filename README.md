# UniDoc Studio

Next.js 16 (App Router, TypeScript, Tailwind v4) app that imports a **UniFi** site (ephemeral API key) or a set of **MikroTik RouterOS 7** devices (read-only REST user), normalizes everything into one sanitized, vendor-neutral `SiteDocumentationSnapshot`, and exports a paginated A4 PDF report rendered by headless Chromium. English only.

## Install

Built for Windows, macOS and Linux (tested on Linux so far). You need **Node.js 22.13 or later** (26 LTS recommended; 22 reaches end of life in April 2027) and one of **Chrome, Chromium or Edge** (used headless for the PDF; Edge is already on Windows).

1. Get the code: `git clone https://github.com/WASP512/unidoc-studio.git`, or on [GitHub](https://github.com/WASP512/unidoc-studio) use **Code → Download ZIP** and unzip it.
2. Install:
   - **Windows:** double-click `install.bat`.
   - **macOS / Linux:** `bash install.sh`
3. Start: double-click `start.bat`, or `bash start.sh`. Then open <http://127.0.0.1:3000>.

The installer checks Node and the browser, installs the dependencies and builds the app. The browser is looked for in the usual install locations (`src/lib/browser-paths.json`); set `CHROME_PATH` for anything else. If Node is missing it says where to get it (`winget install OpenJS.NodeJS.LTS` on Windows). To update, replace the folder (or `git pull`) and run the installer again.

**With Docker instead** (nothing else to install; Chromium is inside the image):

```
docker compose up -d --build      # then open http://127.0.0.1:3000
```

Either way the app listens on the local computer only, because it has no login. See "Deployment" for running it as a service on a server.

### Proxmox (one step)

Run this in the **Proxmox host shell** as root. It creates an unprivileged Debian container, installs the app in it as a service, and puts HTTPS and a login in front of it. When it finishes it prints the address, the login name and a generated password (shown once).

```
curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/proxmox-install.sh | bash
```

Or, from a copy of this repository on the host, `bash deploy/proxmox-install.sh`.

Defaults: next free container ID, hostname `unidoc-studio`, bridge `vmbr0`, DHCP, 2 cores, 2 GB RAM, 8 GB disk. Override with environment variables in front of the command, for example `curl -fsSL <url> | CT_IP=192.168.1.50/24 CT_GATEWAY=192.168.1.1 CT_VLAN=20 bash`; the full list is at the top of the script. Give the container a fixed address (static, or a DHCP reservation): the certificate is issued for the address it has at install time.

The same installer works on any Debian 12 or 13 machine without Proxmox: `bash deploy/provision-debian.sh <source.tar.gz>` as root.

### What an update brings up to date

Each update (button or command) also updates what the app runs on, not only the app:

- **Node.js** from the NodeSource repository, on the release line named in `deploy/provision-debian.sh` (`NODE_MAJOR`, now 26 LTS, supported to April 2029). An install made on an older line is moved to it.
- **Chromium, Caddy, curl and certificates** from Debian, to the newest version Debian offers. Caddy in Debian 12 and 13 is 2.6: old upstream, but patched by Debian's security team. The installer uses the login directive that the installed Caddy understands.
- **npm packages** exactly as pinned in `package-lock.json`.

It does not upgrade the rest of the operating system. For that, run `apt-get update && apt-get -y upgrade` in the container now and then, or install `unattended-upgrades`.

To check the npm side yourself: `npm outdated`, `npm audit`, and `grep -c '"deprecated"' package-lock.json` (0 at the time of writing). Two packages are held one major version back on purpose: TypeScript 6 (the linter's TypeScript support stops below 6.1) and `@types/node` 22 (it follows the oldest Node.js the app supports).

### Updating

Click **Update** at the top right of the page. It shows each step and a progress bar, and the page reloads by itself when the new version is running. If the server already has the latest version it says so.

- When a newer version is waiting, the button turns green and reads **Update available**. The server asks GitHub for the latest commit id when the page is opened or refreshed, at most once every 30 minutes; the request is anonymous and sends nothing about the install. To switch the check off, set `Environment=UNIDOC_UPDATE_CHECK=off` with `systemctl edit unidoc-studio.service`; the button then stays grey and still works.
- The running version stays up while the new one is downloaded and built (about one to five minutes), then the app restarts, which takes a few seconds.
- If the new version does not build, nothing is changed. If it builds but does not start, the previous version is put back. Either way the page says what happened.
- The login and the HTTPS certificate are kept.
- Reloading clears a site that is loaded in the page, so the button asks first when there is one. Save it as a snapshot to keep it.
- The button installs whatever is on the `main` branch of this repository, as root inside the container, and anyone who has the login can click it. To follow a fork or pin a version: `systemctl edit unidoc-studio-update.service` and add `Environment=UNIDOC_REPO=owner/repo` or `Environment=UNIDOC_REF=<tag or commit>` under `[Service]`.

How it works: the app runs as an unprivileged user and cannot update itself. The button creates an empty request file; a root-owned systemd path unit (`unidoc-studio-update.path`) notices it and runs `/usr/local/sbin/unidoc-studio-update` (a copy of `deploy/update.sh`), which writes its progress to `/var/lib/unidoc-studio/update/` where the app can read but not write. The app passes nothing to the updater.

An install made before the button existed needs one last update by hand, on the Proxmox host (the login is kept):

```
pct exec <CTID> -- bash -c "curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/update.sh | bash"
```

The same command also works later as a repair: unlike the button, it reinstalls even when the version is already the latest. The button appears only on installs made by `provision-debian.sh` (Proxmox, Debian); a desktop or Docker install shows its version there and is updated by replacing the folder or rebuilding the image.

Tested: the in-container installer on Debian 12 and 13 containers (service start, HTTPS login, PDF export, re-run). The update button in a Debian 13 systemd container limited to 2 GB of memory, clicked in headless Chrome through the container's own HTTPS login: update from the previous release by the command above, then by the button to a newer version, "already up to date", a version that does not build, and a version that builds but does not start (rolled back). The Proxmox part (`pct create` and friends) has been run on one Proxmox VE host (amd64, Debian 13 template) and otherwise dry-run against stand-in commands.

Other commands:

```
npm run verify                                  # normalizer/sanitizer/identification/findings assertions + page plans
npm run export:demo -- http://127.0.0.1:3000 out.pdf technical clean-light mikrotik on
npm run oui:update                              # refresh data/oui.tsv from the IEEE registries
npm run photos:update                           # refresh UniFi product photos from techspecs.ui.com (needs Pillow)
```

## Sources

| Mode | Access | Data leaves the LAN? |
|---|---|---|
| UniFi Cloud Proxy | Site Manager key → `api.ui.com` Cloud Connector | Yes, through Ubiquiti's cloud |
| UniFi Direct Local | Local Network key → `https://<console>/proxy/network/…` | No |
| MikroTik RouterOS | Username/password (Basic auth) → `https://<device>/rest/…` on each device | No |

Where the capture must not leave the site (for example a network subject to CJIS or similar rules), use Direct Local or MikroTik: both stay on the LAN.

## Report structure

| Page | Content |
|---|---|
| 1 | **Cover**: site, client, scan and issue dates, device/network/AP/client counts, client logo and contact, integrator logo and contact |
| 2 | **Contents** with exact page numbers (clickable in the PDF, which also carries bookmarks), document information, status legend, and the Introduction / Additional notes |
| 3 | Infrastructure summary, Internet / ISP. With more than one WAN, a **WAN links** table lists each link's role, address, ISP and state |
| 4 | Network topology |
| 5+ | Inventory, gateway, switches, ports (including the UniFi gateway's own ports), access points, Wi-Fi, networks, DHCP, clients, health, VPN, firewall, device identification |

Sections run on from one another; a heading is never left at the foot of a page, tables of up to 8 rows are not split, and longer tables repeat their header and never leave fewer than 3 rows behind. Page numbers in the contents come from the same page plan the renderer uses, and `npm run verify` checks them.

Loading the MikroTik demo fills in a fictional client and integrator so the cover and notes are populated. Those details are dropped when the next site is loaded.

## What the MikroTik import adds over UniFi

The report shares the same layout, themes, paginator and PDF path. For RouterOS it also documents:

- **Topology** built from LLDP/CDP/MNDP neighbors on every device (breadth-first from the gateway), CAPsMAN remote CAPs, and third-party switches seen only via LLDP (drawn dashed, marked *Not managed*). Uplinks are labelled with the actual interfaces and link speed (`ether20 ↔ gi10 · 1 Gbit/s`).
- **Per-port table** for every managed router and switch: link, speed, PVID, untagged/tagged VLANs from the bridge VLAN table, PoE status and watts, link partner or learned-MAC count, SFP module, interface comment.
- **Bridge VLAN table** and the full **neighbor table**.
- **Clients with exact switch port and VLAN** from the bridge host table (deepest edge port wins; MACs seen only on trunks become *undetermined*), wireless clients from the CAPsMAN/wifi registration table, plus ARP and DHCP leases. Static leases seen within the window (default 30 days) are listed as **Recently seen**.
- **WAN** from interface lists, DHCP/PPPoE client, default route, `/ip/cloud` public address and Netwatch latency/loss.
- **Firewall filter + NAT** rules (match summarised per rule) and **WireGuard interfaces and peers** (last handshake, allowed addresses).
- Device health: CPU, memory, temperature, RouterOS version, serial numbers.

RouterOS has no ISP speed test or availability history, so those UniFi cells are replaced with link rate, default gateway and the Netwatch probe target.

### RouterOS setup

```
/user group add name=unidoc-ro policy=read,api,rest-api,!write,!policy,!sensitive,!ftp,!reboot
/user add name=unidoc group=unidoc-ro address=<workstation-ip>/32 password=<long-random>
/ip service set www-ssl certificate=<cert> disabled=no address=<mgmt-subnet>
```

Without the `sensitive` policy RouterOS hides keys itself; UniDoc strips them again server-side. Plain HTTP (`www`) is refused unless explicitly allowed in the UI.

## UniFi product photos

Topology cards show the manufacturer's product photo for UniFi devices: 132 models (cloud gateways, switching, Wi-Fi) from the listing pages of techspecs.ui.com, trimmed and bundled as WebP in `public/hardware/unifi/` with a manifest in `src/data/unifi-photos.json`. Reports never contact ui.com at runtime.

Devices are matched by the controller's internal model code (`USPM48P`, `UDMPROSE`, …), then by model name. Unmatched models, and all MikroTik or third-party gear, keep the drawn SVG illustration.

The photos carry no packaging, callouts or overlaid text:

- UX7's listing photo shows the retail box, so its plain front view from the same Ubiquiti product CDN is used instead.
- Devices with a front display (UX, UX7, UCG Max/Ultra/Fiber, UDR, UDR7, UDR-5G-Max, UDW, UTR, UTR-LR, AirWire) have the screen switched off and the printed model name removed, so no screen readouts appear.
- Rack faceplates still carry their tiny factory markings (model name under the display, port numbers). These are a few pixels high and not readable at report size.

The photos are Ubiquiti's product images, used here only to depict Ubiquiti's own products. They are not covered by any licence of this repository; if Ubiquiti objects, delete `public/hardware/unifi/` and set `src/data/unifi-photos.json` to `[]`; the report then uses drawn illustrations.

## Device identification

An optional report section (on by default, every template) lists **every device seen**: connected now plus recently seen. For each device it shows vendor, type, OS/model, where it is attached, a confidence level and the **evidence** behind the result.

Identification is **passive**: nothing is scanned. Signals used:

- the IEEE OUI registry (MA-L/MA-M/MA-S, ~54k prefixes, bundled in `data/oui.tsv`, server-side only);
- whether the MAC is randomized/private;
- DHCP hostname and admin-assigned names (UniFi alias, RouterOS lease comment);
- DHCP option 60 vendor class (`MSFT 5.0`, `android-dhcp-14`, `dhcpcd…BCM2835`, …);
- LLDP/CDP/MNDP system description (e.g. LLDP-MED phones);
- the controller's vendor field.

Results are an indication, not a verified inventory. A randomized-MAC phone with no hostname will rightly come out as *Unknown*.

## Security findings (optional)

Off by default: the report is documentation unless you choose otherwise. Switch it on under **Customize → Security findings**, where the count of findings for the loaded site is shown. Both demo sites load with it on.

The section lists each concern with a severity (High, Medium, Low, Info), what was observed, the devices or rules concerned, and a recommendation. The summary page gets a one-line count with a link to the section, and the Technical template adds a **Checks performed** table.

Checks are automated and read only what the import returned:

| Area | Checks |
|---|---|
| Firewall | Rules allowing traffic in from the internet, guest zone into internal networks (UniFi); input and forward chains dropping unsolicited WAN traffic (RouterOS); port forwards, with remote-administration and file-sharing ports rated High; UPnP; intrusion prevention off (UniFi); SOCKS or web proxy (RouterOS); disabled rules left in place |
| Remote access | PPTP or L2TP servers |
| Wi-Fi | Open networks, WEP or first-generation WPA, WPA2-only |
| Management (RouterOS) | Telnet, FTP, HTTP and unencrypted API; services with no source-address limit; default `admin` account; SNMP community `public`; MAC-Telnet and MAC-WinBox on all interfaces; SSH strong crypto |
| Segmentation | IoT and media devices on the same network as computers; device management addresses on client networks; internal and public DNS resolvers in one DHCP scope |
| Inventory | Unidentified devices and randomized-address devices on internal networks; network equipment that is not managed |
| Maintenance | Firmware or RouterOS updates available; RouterBOARD firmware behind RouterOS |

How to read it:

- A finding is an indication to review, not a verdict. This is not a penetration test or a compliance audit, and a check without a finding does not prove the area is secure.
- A check whose data was not returned (an endpoint the key or the read-only user could not read) is listed as **Not evaluated**, never as passed.
- Findings contain no credentials. User names and SNMP community strings are printed only when they are the vendor default.
- The inventory and IoT checks rest on passive device identification, so they inherit its limits.
- Snapshots saved before this section existed have no results; import the site again.

For the findings, the import reads two more UniFi endpoints (`rest/portforward`, `rest/setting`) and eleven more RouterOS menus (services, users, UPnP, SNMP, MAC server, SSH, proxy, package update). `npm run verify` exercises every check three ways: raised by the demo, cleared by a corrected copy, and not evaluated when its data is missing.

## File tree

```
data/oui.tsv                         IEEE vendor prefixes (npm run oui:update)
src/
  app/
    page.tsx                         3-step studio (import → customize → preview/export)
    print/page.tsx                   print surface loaded by headless Chrome
    api/unifi/{discover,import}      UniFi connector routes
    api/mikrotik/{discover,import}   RouterOS connector routes (probe, neighbor suggestions, import)
    api/demo/route.ts                demo sites, normalized server-side (uses the OUI registry)
    api/export-pdf/route.ts          puppeteer-core → application/pdf
    api/update/route.ts              installed version, update progress, update request (server installs)
  components/UpdateControl.tsx       version label and the Update button with its progress dialog
  components/report/
    ReportDocument.tsx               A4 pages, chrome, all tables (vendor-aware), identification section
    NetworkTopologySection.tsx       5-lane swimlane topology, undetermined block, device table
    HardwareIllustrations.tsx        UniFi product photos; SVG for MikroTik RB/CRS/cAP and generic gear
    ReportTable.tsx                  fixed-height table primitive, status dots, action pills
  lib/
    transport.ts                     server-only HTTP (timeouts, size caps, TLS fingerprint pinning)
    unifi-client.ts / mikrotik-client.ts   server-only connectors
    unifi-normalize.ts / mikrotik-normalize.ts   vendor normalizers
    normalize-common.ts              sanitizer, formatters, finalizeSnapshot (KPIs + identification)
    identify.ts, oui.ts              passive device identification
    update-status.ts                 reads the server updater's progress, files the update request
    findings.ts, findings-unifi.ts, findings-mikrotik.ts   optional security findings (checks + assembly)
    paginate.ts                      deterministic paginator (paginateSnapshot)
    strings.ts, themes.ts, markdown.tsx
  data/
    mock-raw-payloads.ts             UniFi demo payloads (fictional "Demo City Hall" site, planted fake secrets)
    mock-mikrotik-payloads.ts        RouterOS demo payloads (fictional branch, documentation-range IPs)
    mock-snapshot.ts                 demo snapshot builders
  types/unifi-documentation.ts       vendor-neutral model
scripts/
  verify-mock.ts, verify-findings.ts, plan-pages.ts, export-demo-pdf.ts, update-oui.ts
  fetch_unifi_photos.py              techspecs.ui.com photos → public/hardware/unifi (+ screen/wordmark clean-up)
  mock-unifi-server.ts               mock UniFi OS console (HTTPS) + optional Site Manager mock
  mock-routeros-server.ts            mock RouterOS REST API (HTTPS, Basic auth), one port per device
```

## Credential handling

- Keys and RouterOS credentials exist only in React state and password inputs. They are sent only as headers (`X-UniFi-Api-Key`, `X-RouterOS-Credentials` = base64 `user:password`) and cleared after import, on cancel, and on `pagehide`/`beforeunload`.
- Route handlers hold credentials for one request, never log them, and scrub them from error text. Responses are `Cache-Control: no-store`.
- Payloads are sanitized as soon as they arrive (per device for RouterOS): all `x_*` fields plus password/PSK/secret/token/private-key/webhook patterns, including RouterOS names like `private-key`, `preshared-key`, `security.passphrase`. A second pass replaces any string that contains a removed secret value. Only removed field *names* are kept, in `meta.sanitizedFields`.
- The PDF route sanitizes again, whitelists config fields, and injects the payload with `evaluateOnNewDocument` (never a URL). Chrome may only load this app's own origin and `data:` URIs.
- LAN devices (UniFi Direct Local, RouterOS) usually present self-signed certificates, so chain validation is relaxed per connector, never globally. To restore protection against an interposed device, **pin the certificate**: discovery shows each device's SHA-256 fingerprint; paste it into the pin field. With pins set, a credential-free TLS handshake checks the fingerprint *before* any request carrying the key or password is sent.

## Deployment

The app has no login of its own, so anyone who can reach it can use whatever network access the host has. `npm start` and `npm run dev` therefore listen on `127.0.0.1` only. Do not change that to a routable address; put an SSH tunnel or an authenticating reverse proxy in front instead.

### On a server

The quickest route on a server is `docker compose up -d --build` (see "Install"). To run it as a systemd service instead you need Linux, Node.js 22.13 or later, git, and Chrome or Chromium. The server needs to reach the devices it documents: the UniFi console on 443, RouterOS devices on their `www-ssl` port, and `api.ui.com` only for Cloud Proxy mode.

```
sudo useradd --system --create-home --home-dir /opt/unidoc-studio --shell /usr/sbin/nologin unidoc
sudo -u unidoc git clone https://github.com/WASP512/unidoc-studio.git /opt/unidoc-studio/app
cd /opt/unidoc-studio/app
sudo -u unidoc bash install.sh
sudo -u unidoc npm run verify          # optional self-check
```

Install the service (check `User`, `WorkingDirectory` and the npm path in the unit file first):

```
sudo cp deploy/unidoc-studio.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unidoc-studio
curl -sI http://127.0.0.1:3000 | head -1     # expect HTTP/1.1 200 OK
```

Open it from your own machine through an SSH tunnel, then browse to `http://127.0.0.1:3000`:

```
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

Notes:

- Run the service as an unprivileged user. Chrome's sandbox is only disabled when the process runs as root or `UNIDOC_CHROME_NO_SANDBOX=1` is set; use that variable only if Chrome refuses to start in a container or restricted host.
- If Chrome is not found, set `CHROME_PATH` in the unit file.
- Behind a reverse proxy, the PDF renderer still loads the report from `http://127.0.0.1:$PORT`; set `UNIDOC_INTERNAL_ORIGIN` only if the app listens somewhere else.
- To update: `git pull && bash install.sh`, then `sudo systemctl restart unidoc-studio`.

### Before publishing the repository

`bash scripts/check-publishable.sh [pattern-file]` fails if a key or certificate is tracked, if a sample PDF contains a secret marker, or if tracked text or a sample PDF matches a pattern from your own (uncommitted) list of real-site names and addresses. Both demo sites are fictional; never commit a snapshot or PDF from a real network.

## UniFi API notes

- **Cloud Connector path.** `https://api.ui.com/v1/connector/consoles/{hostId}/network/<path>` (executed by the console as `/proxy/network/<path>`). Limits: 100 requests/min per console, 25 s per request, 10 MB body, console firmware ≥ 5.0.3.
- **ISP metrics.** `GET /v1/isp-metrics/5m?duration=24h`. Direct Local falls back to `stat/health` → `uptime_stats.WAN`.
- **Client history.** `POST stat/alluser {type:"all", conn:"all", within:<hours>}` adds recently-seen clients.
- **Legacy endpoints through the Cloud Connector.** Ubiquiti documents the connector against the Network *integration* API; whether every legacy `api/s/...` and `v2/...` endpoint is accepted depends on firmware. Each endpoint's result shows in the Import report; failures are non-fatal except `stat/device`.

## Testing without hardware

```
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=lab.local -keyout /tmp/l.key -out /tmp/l.crt
MOCK_KEY=<16+ char test key> npm run mock:console -- /tmp/l.key /tmp/l.crt 8443 --cloud 8780
MOCK_ROS_USER=unidoc MOCK_ROS_PASS=<test password> npm run mock:routeros -- /tmp/l.crt /tmp/l.key 8731
# UniFi Direct Local: 127.0.0.1:8443 · UniFi Cloud: start the app with UNIDOC_SITE_MANAGER_BASE=http://127.0.0.1:8780
# MikroTik: devices 127.0.0.1:8731, :8732, :8733
```

The RouterOS field names in the normalizer follow the v7 REST documentation; they have only been exercised against the mock, not a physical device yet.
