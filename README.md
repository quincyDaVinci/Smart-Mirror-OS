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

- Jellyfin base URL and API key
- Spotify client ID, client secret, refresh token, and redirect URI
- Weather location, country code, API key, latitude, and longitude
- Calendar feed URLs

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
