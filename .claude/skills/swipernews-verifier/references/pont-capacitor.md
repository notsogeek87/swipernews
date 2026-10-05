# Simuler le pont Capacitor dans le navigateur

Pour exercer les chemins **natifs** (`isNativeApp`) depuis Chromium, simuler le pont avant le chargement de la page. C'est ainsi qu'ont été vérifiés les réglages du lecteur.

```js
await page.addInitScript(() => {
  // sinon le panneau d'accueil s'ouvre tout seul et bloque les clics
  localStorage.setItem("fluxswipe.interests.v1", JSON.stringify(["sciences"]));
  window.__opened = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      InAppBrowser: {
        open: (o) => {
          window.__opened.push(o);
          return Promise.resolve();
        },
        syncBlocklist: () => Promise.resolve({ count: 50047 }),
        clearBlocklist: () => Promise.resolve(),
      },
    },
  };
});
```

Le `localStorage.setItem` d'intérêts évite que le panneau d'accueil s'ouvre tout seul et bloque les clics. Chromium : `executablePath: "/opt/pw-browsers/chromium"` ; servir le dépôt avec `python3 -m http.server 8124`.
