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
- ODROID kiosk setup support

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
    ├── providers/        # Jellyfin, Spotify, weather, calendar providers
    ├── sensors/          # VEML light sensor integration
    ├── index.js          # Backend entrypoint
    └── secretsStore.js   # Local secrets storage
