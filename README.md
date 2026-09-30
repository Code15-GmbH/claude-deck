# Claude Tower

Fluglotsen-Board für alle laufenden Claude-Code-Sessions über alle Profile (Normal, Belege, Planung) und Projekte. Was zuletzt fertig geworden ist, liegt oben, blinkt kurz auf und zeigt, wo die Session liegt (iTerm, Desktop, Tab). Gedacht für ein Tablet auf dem Schreibtisch oder einen Raspberry Pi am Wandbildschirm.

```
Claude-Session (jedes Profil)                 Mac                                  Tablet / Pi
  Hook: SessionStart, UserPromptSubmit,  -->  server/server.mjs  (Port 4777)  -->  Browser, Live-Updates per SSE
        Stop, Notification, SessionEnd        · Zustand in ~/.claude-tower/state.json
  hook/tower-hook.sh (~0,1 s, blockiert nie)  · Desktop/Tab per iTerm-AppleScript + SkyLight
```

Die Daten verlassen das lokale Netz nicht. Die Hooks senden nur an `127.0.0.1`.

## Start

```sh
npm install
npm run build          # baut das Dashboard nach web/dist
npm start              # startet den Server und gibt die Dashboard-Links mit Schlüssel aus
npm run urls           # die Links noch einmal anzeigen
```

Beim ersten Start wird `~/.claude-tower/config.json` angelegt (chmod 600) mit Port, `ingestToken` (für die Hooks) und `viewToken` (für den Dashboard-Link, nur Lesezugriff). Tablet oder Pi öffnen `http://MacBook-Pro-von-Nico.local:4777/?key=<viewToken>`. Den Schlüssel merkt sich das Gerät danach.

Beim ersten Start von außen fragt die macOS-Firewall eventuell, ob `node` eingehende Verbindungen annehmen darf. Wenn der Server per LaunchAgent läuft, fragt macOS einmal, ob `node` iTerm steuern darf (für die Desktop-Erkennung).

## Hooks in die Claude-Profile eintragen

```sh
npm run hooks:check      # Trockenlauf: zeigt, was in welche settings.json käme
npm run hooks:install    # schreibt die Einträge (mit Backup *.bak-<zeit>-tower)
npm run hooks:uninstall  # entfernt nur die Tower-Einträge wieder
```

Betroffen sind `~/.claude/settings.json` (gilt über den Symlink auch für `code15-belege`) und `~/.claude-profiles/planni/settings.json`. Bestehende Hooks (Telegram, Jev-Router, AgentDeck, gstack) bleiben unverändert. AgentDeck-Upgrades und `agentdeck-reapply-profile` entfernen nur AgentDeck-eigene Einträge, deshalb überleben die Tower-Hooks beides. Hinweis: Der Installer schreibt die JSON-Datei neu formatiert (2 Leerzeichen, `/` statt `\/`). Inhaltlich ändert sich nur der Hook-Block.

## Testen ohne echte Sessions

```sh
npm run simulate           # ca. 40 s: fünf Fake-Sessions arbeiten und werden nacheinander fertig
node scripts/simulate.mjs --fast   # gefülltes Board sofort
node scripts/simulate.mjs --end    # Fake-Sessions schließen
npm test                   # Unit-Tests der Zustandslogik (node --test, kein Watch-Modus)
```

## Dashboard-Optionen (URL)

| Parameter   | Wirkung |
|-------------|---------|
| `key=…`     | Lese-Schlüssel, nur beim ersten Aufruf nötig |
| `minimal=1` | blendet Auftrag und Ergebnis aus, zeigt nur Projekt und Titel (Wandbildschirm mit Besuch) |
| `sound=1`   | Ton bei „fertig“ und „Freigabe“ (am Pi mit Kiosk-Flag, sonst über den Knopf „Ton“) |
| `still=1`   | keine Animationen (für sehr schwache Hardware) |

## Raspberry Pi als Wandbildschirm

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required \
  "http://MacBook-Pro-von-Nico.local:4777/?key=<viewToken>&sound=1"
```

## Was „auf welchem Desktop“ bedeutet

* **iTerm2**: Über `ITERM_SESSION_ID` findet der Server per AppleScript Fenster und Tab und über die private SkyLight-API den Mission-Control-Desktop („Desktop 5“). Das funktioniert zuverlässig, auch wenn Fenster verschoben werden (alle 10 s aktualisiert).
* **Cursor / VS Code / Terminal.app**: Es werden nur App und TTY angezeigt, kein Desktop.
* Die SkyLight-API ist privat (dieselbe, die yabai zum Lesen nutzt). Nach einem macOS-Update kann sie wegfallen. Dann fehlt nur die Desktop-Nummer, alles andere läuft weiter.

## Autostart (optional)

`scripts/dev.claude-tower.plist` ist ein LaunchAgent-Template. Die Installationsschritte stehen in der Datei. Es wird nicht automatisch installiert.

## Warum lokal und nicht auf Vercel

Die Sessions laufen nur, wenn der Mac läuft. Ein Cloud-Dashboard hätte also nichts, was ein lokales nicht auch hat. Dafür bräuchte es einen öffentlichen Endpunkt, Zugriffsschutz und einen externen Speicher (Redis/KV) für vertrauliche Task-Texte, und die Desktop-Erkennung müsste trotzdem lokal laufen. Für den Zugriff von unterwegs ist Tailscale auf Mac und Tablet der kleinere Schritt. Der Hook kann über `TOWER_URL`/`TOWER_TOKEN` aber auch an einen anderen Server senden, falls es doch einmal eine gehostete Variante geben soll.
