# Checklist campeggio

Checklist mobile-first per preparare campeggio, barbecue e zainetto da trekking.

## Funzioni

- categorie ed elementi personalizzabili direttamente dal telefono;
- spunte, categorie ed elementi salvati automaticamente nel browser tramite `localStorage`;
- migrazione automatica delle spunte dalla chiave legacy `campeggio-checklist-v1`;
- avanzamento totale e per categoria;
- funzionamento offline dopo la prima apertura grazie al service worker;
- condivisione del link dal telefono;
- nessun account o dato inviato a un server.

## Avvio locale

```bash
python3 -m http.server 4173
```

Aprire `http://127.0.0.1:4173`.

## Test UI

Con Chromium avviato con un endpoint CDP sulla porta `9223` e il server locale attivo:

```bash
node test-ui.mjs
```

Il test copre migrazione, creazione e cancellazione, persistenza, progressivi e reload offline; genera anche `preview.png` a 390×844.
