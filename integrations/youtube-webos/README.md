# youtube-webos Smart Mirror bridge

Deze bridge is bedoeld voor de op de LG C9 gebruikte `youtube.leanback.v4`
build op basis van NicholasBly/youtube-webos 0.8.3.

## Wijzigingen in de youtube-webos clone

1. Kopieer `smart-mirror-bridge.js` naar `src/smart-mirror-bridge.js`.
2. Voeg in `src/userScript.js` direct onder:

```js
import './sponsorblock.js';
```

deze regel toe:

```js
import './smart-mirror-bridge.js';
```

Daarna opnieuw bouwen en verpakken met de bestaande youtube-webos tooling.

De bridge stuurt elke 5 seconden en bij play/pause/seek/end/visibility-wijzigingen
een `text/plain` heartbeat naar:

```text
http://192.168.68.123:8787/media/youtube-heartbeat
```

De Smart Mirror backend haalt metadata zelf op via YouTube oEmbed. De LG-app
stuurt dus geen API-key, titel, kanaal of thumbnail.
