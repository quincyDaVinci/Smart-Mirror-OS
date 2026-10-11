# Smart Mirror OS

Smart Mirror OS is a React + Node.js smart mirror dashboard built for a physical mirror setup. It combines a kiosk-style mirror UI, an admin panel, a mobile remote, media context, weather, calendar data, and sensor-driven sleep behavior.

The project was built as part of a frontend development minor and is optimized for a single board computer setup, currently an ODROID N2-style device running a Firefox kiosk.

## Features

- Mirror dashboard with clock, weather, media, and calendar widgets
- Admin page for layout, display, sensor, provider, and deployment settings
- Mobile remote page for focusing widgets and controlling mirror state
- Sleep, dim, and active display states
- VEML light sensor support for context-aware wake/sleep behavior
- Jellyfin now-playing support
- Spotify now-playing and lyrics support
- Calendar feed support
- Weather support
- WebSocket live state updates with HTTP fallback
- Kiosk setup support

## Tech stack

- React
- TypeScript
- Vite
- Node.js
- Express
- WebSocket
- Optional I2C light sensor support

## Project structure

```text
.
├── src/                  # React frontend
│   ├── components/       # Mirror/admin/shared UI components
│   ├── hooks/            # WebSocket and app state hooks
│   ├── pages/            # Mirror, admin, and remote pages
│   ├── types/            # Shared frontend types
│   └── utils/            # Frontend utilities
├── server/               # Node.js backend
│   ├── providers/        # Jellyfin, Spotify, weather, calendar providers
│   ├── sensors/          # VEML light sensor integration
│   ├── index.js          # Backend entrypoint
│   └── secretsStore.js   # Local secrets storage
└── public/               # Static assets
```

## Requirements

- Node.js 20 or newer
- npm
- A modern browser
- Optional: Linux SBC with display/kiosk setup
- Optional: VEML7700-compatible light sensor over I2C

The current physical target setup uses:

- Frontend port: `4173`
- Backend port: `8787`
- Kiosk browser: Firefox
- Display stack: LightDM + X11
- Target resolution: `2560x1440`

## Local development

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
cd server
npm install
cd ..
```

Start the backend:

```bash
cd server
npm start
```

In another terminal, start the frontend:

```bash
npm run dev -- --host
```

Open:

```text
http://localhost:5173/
http://localhost:5173/admin
http://localhost:5173/remote
```

## Production preview

Build the frontend:

```bash
npm run build
```

Run the Vite preview server:

```bash
npm run start
```

Start the backend:

```bash
cd server
npm start
```

Open:

```text
http://localhost:4173/
```

## Environment variables

The frontend can connect to a custom backend WebSocket URL with:

```bash
VITE_WS_URL=ws://localhost:8787
```

Copy `.env.example` to `.env.local` if needed:

```bash
cp .env.example .env.local
```

For most local setups, this is optional. If `VITE_WS_URL` is not set, the frontend connects to port `8787` on the current hostname.

## Provider configuration

Provider secrets are stored locally in:

```text
server/secrets.local.json
```

This file is intentionally ignored by Git and must never be committed.

You can configure providers from the admin page, or create the file manually using:

```bash
cp server/secrets.local.example.json server/secrets.local.json
```

Supported provider settings:

- Jellyfin base URL, API key, optional exact `userName` filter, and optional exact `deviceName` filter
- Spotify client ID, client secret, refresh token, and redirect URI
- Weather location, country code, API key, latitude, and longitude
- Calendar feed URLs

For shared Jellyfin servers, set `userName` to your own exact Jellyfin username so other users' activity never appears on the mirror. `deviceName` is an optional second exact-match filter if you also want to pin the mirror to one client device.

## Security notes

Do not commit:

```text
server/secrets.local.json
server/state.json
.env
.env.local
*.local
```

Before publishing or pushing changes, run:

```bash
git status --short
git diff --cached
grep -RIn "api_key\|clientSecret\|refreshToken\|access_token\|password\|secret" . \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude=package-lock.json
```

Runtime state can contain local media metadata and artwork URLs. Treat `server/state.json` as private runtime data.

## Kiosk notes

The production mirror setup uses systemd services:

```text
smart-mirror-backend.service
smart-mirror-frontend.service
```

Useful checks on the device:

```bash
curl -I http://localhost:4173/
curl -s http://localhost:8787/state | head

systemctl status smart-mirror-backend.service --no-pager
systemctl status smart-mirror-frontend.service --no-pager
```

For X11 display commands over SSH:

```bash
export DISPLAY=:0
export XAUTHORITY=/home/quincy/.Xauthority
```

Current safe-area display command used for the physical mirror frame:

```bash
xrandr --fb 2560x1440 --output HDMI-1 --mode 2560x1440 --pos 0x0 --panning 2560x1440+0+0/2560x1440+0+0/0/0/0/0 --transform 1.0258,0,-31,0,1.0264,-38,0,0,1
```

Do not run `xrandr --transform none` after this command, because that removes the safe-area correction.

## Admin servicebeheer en Firefox kiosk (ODROID)

De Admin-pagina bevat onder **Services** de acties **Start** en **Herstart**
voor `smart-mirror-frontend` en `smart-mirror-backend`, plus
**Herstart beide services**. Status wordt elke vijf seconden opgevraagd via
`GET /admin/services`. Alleen vaste systemd-doelen en operaties zijn toegestaan.

Op de ODROID is met `sudo -n -l` gecontroleerd dat `quincy` deze
drie restartcommando's zonder wachtwoord mag uitvoeren:

```bash
sudo -n systemctl restart smart-mirror-frontend
sudo -n systemctl restart smart-mirror-backend
sudo -n systemctl restart smart-mirror-backend smart-mirror-frontend
```

**Start** doet niets als de service al `active` is. Als die gestopt is, gebruikt
de backend de al toegestane `systemctl restart` om de service te starten.
Er hoeft hiervoor niets in sudoers gewijzigd te worden.

**Frontend is niet hetzelfde als Firefox:** de frontend-service serveert de
app op poort 4173, terwijl de Firefox kiosk de app op het fysieke scherm toont.
Daarom heeft Admin een aparte sectie **Firefox kiosk** met
**Start Firefox kiosk** en **Herstart Firefox kiosk**. De browserstatus wordt
elke vijf seconden opgevraagd via `GET /admin/kiosk`.

`POST /admin/kiosk` gebruikt alleen de bestaande launcher
`/home/quincy/bin/open-smartmirroros.sh` en accepteert alleen de operaties
`start` of `restart`. Er worden geen arbitraire shellopdrachten verwerkt.
Bij **Start** wordt niets gedaan als Firefox al draait; **Herstart** herstart
de bestaande kioskflow. De launcher bepaalt zelf hoe Firefox, de X11-display
(`DISPLAY=:0`), DPMS, cursor hiding en de veilige XRandR-calibratie werken.
De backend gebruikt `systemd-run --user` om de launcher buiten de backend-
servicecgroup te starten, zodat een volgende backendrestart Firefox niet
automatisch afsluit. Hiervoor moet de gebruikerssessie van `quincy`
(`/run/user/1000/bus`) actief zijn.

Als de kiosk niet opent, controleer op de ODROID (in een SSH-terminal):

```bash
cd /home/quincy/Smart-Mirror-OS
ls -l /home/quincy/bin/open-smartmirroros.sh
ls -l /home/quincy/bin/start-smart-mirror-browser.sh
test -S /tmp/.X11-unix/X0 && echo "X11 actief" || echo "X11 niet actief"
pgrep -a firefox || true
systemctl --user status --no-pager
journalctl --user -n 80 --no-pager
```

De verwachte situatie: beide launchers zijn uitvoerbaar, X11 is actief,
en na de startactie verschijnt een Firefox-proces en de kiosk op het scherm.
Controleer de daadwerkelijke weergave: een geslaagde startaanvraag bewijst
nog niet dat Firefox zichtbaar is.

**Beperkingen:** een volledig gestopte backend kan zichzelf niet via het
Admin-paneel starten. Een volledig gestopte frontend kan geen nieuwe Admin-
pagina serveren. De bestaande systemd `Restart=always` blijft nodig.
De HTTP-origincheck is geen authenticatie; bied poort 8787 nooit openbaar aan.

De bestaande **Deployment**-sectie haalt GitHub-code binnen, bouwt de frontend
en herstart backend/frontend. Het herstarten van die services is niet hetzelfde
als het starten van de Firefox kiosk. Een GitHub-push op zichzelf verandert de
draaiende ODROID niet.

## Scripts

Frontend:

```bash
npm run dev
npm run build
npm run lint
npm run preview
npm run start
```

Backend:

```bash
cd server
npm start
```

## Known limitations

- The kiosk/display setup is currently tailored to one physical SBC mirror setup.
- Sensor support depends on Linux/I2C availability.
- Provider integrations need personal API credentials.
- Some display calibration values are specific to the physical frame.
- Runtime state may contain local media metadata and should not be committed.

## License

MIT
