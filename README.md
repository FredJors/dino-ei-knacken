# 🥚 Dino-Ei knacken – interaktives TikTok-LIVE-Spiel

Zuschauer kommentieren im Chat → das Dino-Ei wackelt, reißt und schlüpft. Das Spiel läuft im Browser
(9:16, 1080×1920) und wird per **TikTok LIVE Studio** oder **OBS** gestreamt. Du moderierst mit deiner
Stimme – das Spiel liefert die Show drumherum.

**Sofort testen (iPad/Handy/PC):** <https://fredjors.github.io/dino-ei-knacken/>
(ohne Bridge startet automatisch der **Testmodus** mit simulierten Zuschauern)

---

## Inhalt

1. [Projektstruktur](#projektstruktur)
2. [Schritt 1: Spiel testen (iPad, ohne Installation)](#schritt-1-spiel-testen-ipad-ohne-installation)
3. [Schritt 2: Bridge zu TikTok (Windows-PC)](#schritt-2-bridge-zu-tiktok-windows-pc)
4. [Einbindung in TikTok LIVE Studio / OBS](#einbindung-in-tiktok-live-studio--obs)
5. [Host-Panel & Tastenkürzel](#host-panel--tastenkürzel)
6. [So funktioniert das Spiel](#so-funktioniert-das-spiel)
7. [Einstellungen & Balancing](#einstellungen--balancing)
8. [Moderation](#moderation)
9. [Daten, Speicherstand & Statistik](#daten-speicherstand--statistik)
10. [Fehlerbehebung](#fehlerbehebung)

---

## Projektstruktur

```
game/index.html        Komplettes Spiel in EINER Datei (HTML/CSS/JS, Canvas 2D, keine CDNs,
                       Sounds per WebAudio). Läuft per Doppelklick und als statische Seite.
game/assets/           Bilder für den Höhlen-Look: Höhle (normal + Boss), 6 Eier + Boss-Ei,
                       10 Dino-Arten, Steinnest, Meteor. Fehlt ein Bild, zeichnet das Spiel die
                       alte Grafik (Wiese, gezeichnete Dinos) – es läuft also immer.
tools/prepare_assets.py  Bereitet neue KI-Bilder aus dem Ordner Bilder/ auf (Magenta freistellen,
                       zuschneiden, verkleinern) und legt sie nach game/assets.
bridge/server.js       Node.js-Bridge: TikTok-LIVE-Events → WebSocket → Spiel.
                       Liefert das Spiel zusätzlich unter http://localhost:8787/ aus.
bridge/.env.example    Vorlage für deine Einstellungen (nach .env kopieren).
bridge/start.bat       Doppelklick-Start der Bridge (Windows).
bridge/demo.bat        Bridge im Demo-Modus (simulierte Events, ohne TikTok).
.github/workflows/     Veröffentlicht game/ automatisch auf GitHub Pages (bei jedem Push auf main).
```

Alle Spielwerte stehen zentral im Objekt **`CONFIG`** ganz oben im Skript von `game/index.html`.

---

## Schritt 1: Spiel testen (iPad, ohne Installation)

1. <https://fredjors.github.io/dino-ei-knacken/> in Safari öffnen.
2. Einmal auf das Spielbild tippen → Ton an.
3. Unten erscheint die **Test-Leiste** (nur im Testmodus):
   `💬 C` Kommentar · `❤️ L` Likes · `⭐ F` Follow · `📣 S` Share · `💎 G` Gift · `1` / `2` Duell-Teams · `⚙️ Panel`
4. Im **Panel** (⚙️ oder 1 Sekunde oben links gedrückt halten) stellst du die Zahl der simulierten
   Zuschauer (0–500) und ihre Aktivität ein, löst Boss-Ei/Duell/Ereignisse aus und änderst alle Werte.

Mit Tastatur (PC/iPad-Keyboard) gehen die Tasten `C L F S G 1 2` und alle Hotkeys direkt.

> Tipp: Die Testnamen enthalten absichtlich ein paar unanständige Namen – im Bild müssen sie als
> „Anonymer Knacker“ erscheinen.

---

## Schritt 2: Bridge zu TikTok (Windows-PC)

**Voraussetzung:** [Node.js](https://nodejs.org) **20 oder neuer** (LTS).

```powershell
git clone https://github.com/FredJors/dino-ei-knacken.git
```

### Einfachster Weg: Doppelklick

1. `bridge\start.bat` doppelklicken.
   Beim ersten Start werden die Pakete installiert und Notepad öffnet die `.env`.
2. In der `.env` bei `TIKTOK_USERNAME=` deinen TikTok-Namen **ohne @** eintragen, speichern, schließen.
3. Das Fenster zeigt jetzt:
   ```
   Spiel:      http://localhost:8787/
   Host-Panel: http://localhost:8787/?panel
   ```
4. Geh live. Die Bridge versucht alle 30 s, deinen LIVE zu finden, und verbindet sich automatisch.

### Per Kommandozeile

```powershell
cd bridge
```
```powershell
npm install
```
```powershell
copy .env.example .env
```
```powershell
npm start
```

### Ohne TikTok testen (Demo-Modus)

`bridge\demo.bat` doppelklicken (oder `npm run demo`). Die Bridge erzeugt simulierte Kommentare, Likes,
Follows usw. – so prüfst du die ganze Kette Bridge → Spiel → Panel, ohne live zu sein.

### Was die Bridge macht

- Liest Kommentare, Likes, Follows, Shares, Gifts, Beitritte und Zuschauerzahl mit
  [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector) (v2, `TikTokLiveConnection`/`WebcastEvent`).
- Leitet sie per WebSocket (`ws://localhost:8787`) ans Spiel weiter.
- **Reconnect mit Backoff**: Verbindungsabbruch, Stream-Ende, „nicht live“, Rate-Limit – alles wird
  abgefangen, die Bridge läuft weiter und verbindet sich neu.
- Gift-Serien werden erst am Ende gezählt (kein Mehrfachzählen).
- Log in der Konsole und unter `bridge/logs/bridge-JJJJ-MM-TT.log`.
- Nur lokale Seiten, `file://` und `*.github.io` dürfen sich verbinden (Schutz vor fremden Webseiten).

> ⚠️ `tiktok-live-connector` ist eine **inoffizielle** Bibliothek. TikTok kann jederzeit etwas ändern.
> Dann zeigt das Panel „TikTok: Fehler/getrennt“ – das Spiel läuft trotzdem weiter. Im Zweifel:
> `npm update tiktok-live-connector` im Ordner `bridge` und neu starten.

---

## Einbindung in TikTok LIVE Studio / OBS

Wichtig: **Nur EIN Spiel-Fenster gleichzeitig** öffnen, wenn die Bridge läuft (sonst laufen zwei Spiele parallel).

### Variante A: TikTok LIVE Studio (Fensteraufnahme)

1. Bridge starten.
2. Spiel als schlankes App-Fenster ohne Adressleiste öffnen (PowerShell):
   ```powershell
   Start-Process chrome -ArgumentList '--app=http://localhost:8787/','--window-size=608,1080'
   ```
   (mit Edge: `msedge` statt `chrome`)
3. **Einmal ins Spiel klicken** (Browser erlauben Ton erst nach einem Klick).
4. In LIVE Studio: Quelle hinzufügen → **Fensteraufnahme** → das Spiel-Fenster wählen.
   Szene auf Hochformat (9:16) stellen und die Quelle formatfüllend ziehen.
5. Das **Host-Panel in einem eigenen Fenster** öffnen: <http://localhost:8787/?panel>
   (z. B. auf dem zweiten Bildschirm). Dieses Fenster nimmst du NICHT auf.
6. Fenster möglichst **groß** halten (volle Bildschirmhöhe) – je größer, desto schärfer im Stream.
   Das Spielbild wird intern immer in 1080×1920 gezeichnet und passt sich jeder Fenstergröße an.

### Variante B: OBS (Browserquelle, beste Qualität)

1. Bridge starten.
2. OBS: Quelle → **Browser**
   - URL: `http://localhost:8787/`
   - Breite **1080**, Höhe **1920**, FPS 60
   - ✅ „Audio über OBS steuern“ · ❌ „Quelle herunterfahren, wenn nicht sichtbar“
3. Host-Panel im normalen Browser öffnen: <http://localhost:8787/?panel>
   (Hotkeys funktionieren auch im Panel-Fenster.)
4. Aus OBS streamst du mit TikTok-Stream-Key (falls freigeschaltet) oder gibst OBS per
   „Virtuelle Kamera“ als Kamera-Quelle an LIVE Studio weiter.

### Sichere Bereiche (bereits eingehalten)

- Unteres Drittel (Chat) und rechter Rand (TikTok-Buttons): nur Deko (Höhlenboden, Lava, Herde).
- Oben: großer Aufruf „Kommentiere, um das Ei zu knacken!“, darunter Meteor-Timer und Fortschritt.
- Rechts oben die große Bestenliste „TOP KNACKER“, links die Spielregeln „So geht's“ (immer sichtbar – nur eine Mission verdrängt sie kurz) und das Lexikon.
- Ei im Steinnest auf der Felskante, knapp über der Bildmitte.

---

## Host-Panel & Tastenkürzel

| Taste | Funktion |
|---|---|
| **H** | Host-Panel ein/aus (im Spiel-Fenster) |
| **B** | Boss-Ei als Nächstes |
| **D** | Ei-Duell als Nächstes |
| **E** | Zufallsereignis (Tropfen, Beben, Lava-Ausbruch, Falter, Glühwürmchen, Stolpern, Flugsaurier, Herden-Parade) |
| **P** | Pause-Screen „Gleich geht's weiter!“ (Timer steht) |
| **M** | Ton an/aus |
| **R** | aktuelles Ei neu starten (Herde & Bestenlisten bleiben) |
| **N** | 🎯 Mini-Mission jetzt starten (z. B. wenn du gerade Leute anheizen willst) |
| **X** | 🔥 Hype sofort auslösen |
| **C L F S G 1 2** | Test-Events (nur im Testmodus) |

**Wo ist das Panel im Stream unsichtbar?**
- **Empfohlen:** eigenes Fenster `…/?panel` (Button „Panel in eigenem Fenster öffnen“). Es verbindet sich
  automatisch mit dem Spiel – im selben Browser direkt, sonst über die Bridge (z. B. Spiel in OBS, Panel in Chrome).
- Im Spiel-Fenster selbst (Taste H): Ist das Fenster breit genug, dockt das Panel **rechts neben** dem
  9:16-Bild an (dann Aufnahme auf das Spielbild zuschneiden). Ist es zu schmal, liegt es darüber –
  das Panel warnt dann, dass es im Stream sichtbar wäre.
- Auf dem iPad: ⚙️-Button in der Test-Leiste oder 1 s oben links gedrückt halten.

**Live-Status im Panel:** Bridge verbunden?, TikTok-Status, aktive Nutzer (60 s), Interaktionen/Minute,
Zeit bis Meteor, Modus, Ei-HP, nächster Modus, FPS.

---

## So funktioniert das Spiel

**Ablauf (Normales Ei):** Ansage „Ei #12“ → Ei fällt ins Nest → Zuschauer knacken es → 5 Riss-Stufen
(20/40/60/80/100 %) mit Splittern & Screenshake → Schlüpfen mit Konfetti → Karte (~6 s) mit Art,
Seltenheit, Name und Top-3-Helfern → der Dino läuft in die Herde → neues Ei in neuer Farbe.

| Interaktion | Wirkung |
|---|---|
| Kommentar (beliebiger Text) | 1 Treffer (pro Nutzer max. 1 Treffer / 2 s) |
| Likes | kleiner, gebündelter Schaden – vor allem Wackeln |
| Follow | großer Treffer + Riesenriss + „Danke fürs Folgen, NAME!“ |
| Share | mittlerer Treffer |
| Gift | Bonus nach Diamantwert, **gedeckelt** – das Spiel ist komplett ohne Gifts schaffbar; es gibt keinerlei Aufforderung zu Gifts |
| erster Kommentar | Begrüßung „NAME ist dabei!“ |

- **Wackeln:** Stärke = Aktivität der letzten ~5 s (Feder-Physik: Kippen + Hüpfen); in Ruhe „atmet“ das Ei.
- **Helfer-Dinos:** Wer pro Ei zum ersten Mal mitmacht, bekommt einen Dino mit Namensschild (jeder
  Zuschauer hat immer dieselbe der 10 Arten), der ans Ei läuft und bei jedem Treffer pickt
  (max. 30, nach 60 s Inaktivität laufen sie weg). Die Namensschilder weichen einander aus.
- **Name-Pops:** Bei Treffern poppt der Name am Ei auf (max. 8, sonst „+N weitere“).
  **Combo:** Wer mehrmals kurz hintereinander kommentiert, bekommt einen großen „name x5 🔥“-Pop.
- **Bestenliste:** Top-5 „TOP KNACKER“ (rechts oben, große Glas-Tafel, mit Profilbild) – abwechselnd
  dieses Ei / heute / gesamt (die Reiter zeigen, welche Liste gerade läuft).
  Der Top-Knacker des aktuellen Eis bekommt eine **👑 Krone** auf seinem Helfer-Dino.

### Start-Bots

Damit am Anfang des LIVEs schon etwas passiert, füllen **Bots** die Höhle auf, solange weniger als
20 echte Mitspieler da sind (echt = hat in den letzten 5 min mitgemacht). Jeder neue echte Mitspieler
ersetzt nach und nach einen Bot; wird es später ruhig, kommen Bots zurück. Bots heißen sichtbar
„Bot Rexi“, „Bot Trixi“ …, hauen nur aufs Ei (keine Likes, Follows, Shares oder Geschenke), stehen in
keiner Bestenliste, bekommen keine Krone, benennen keine Dinos und zählen nicht in der Statistik.
Im Panel: **„Start-Bots“** an/aus, „Auffüllen bis“ (Standard 20) und Bot-Aktivität. Das Status-Feld
„Aktive Nutzer“ zeigt, wie viele davon Bots sind. Im Testmodus (ohne Bridge) gibt es keine Bots –
dort simuliert der Testmodus die Zuschauer.

### Mehr Action

- **🎯 Mini-Missionen** (alle ~1–1,5 min, nicht im Duell): z. B. „25 Kommentare in 30 s!“, „100 Likes in 20 s!“,
  „8 verschiedene Leute in 30 s!“, „1 neuer Follower in 60 s!“, „Teilt den LIVE“. Das Ziel richtet sich nach der
  aktuellen Aktivität. Geschafft → **MEGA-RISS** (15 % der Ei-HP). Keine Gift-Missionen.
- **🔥 Hype-Säule** (links neben dem Ei): füllt sich durch Kommentare, Likes, Follows, Shares. Voll →
  **12 s doppelter Schaden**, Bildrand glüht, Herde springt. Bei normaler Aktivität etwa alle 1,5–2 min,
  bei viel Chat öfter.
- **💬 Das Ei redet:** Sprechblasen wie „Hallo? Ist da wer? 🥚“ bei Flaute, „Da knackt was! 😮“ bei Rissen,
  „Der Meteor kommt! 😱“ in den letzten 30 s.
- **Große Ansagen:** „HALB GESCHAFFT! 💪“, „Gleich ist es so weit!“, „FAST GESCHAFFT! 🔥“ (ab 90 % glüht das Ei).
- **❤️ Likes fliegen** als Herzen sichtbar zum Ei.
- **Die Herde lebt:** springt beim Schlüpfen und beim Hype, erschrickt beim Einschlag.
- **Helfer-Dinos** hüpfen ab und zu vor Freude, auch ohne Treffer.
- **Meteor-Countdown:** Standard 4 min. Der Meteor wird größer & heller, in den letzten 30 s wird es
  dringlicher (Herzschlag, Ticken, Grollen). Geschafft → Meteor verglüht. Nicht geschafft → BUMM!
  mit Staubwolke, „Ihr hattet 78 % geschafft!“, das nächste Ei ist weicher.
- **Seltenheiten:** Gewöhnlich 60 %, Selten 25 %, Episch 12 %, Legendär 3 %. Gewöhnliche Dinos haben
  ihre Originalfarbe, seltene sind blau/türkis/grün umgefärbt, epische lila/pink, legendäre golden –
  dazu ein farbiger Schein und Funkeln, ab Episch Extra-Fanfare. 10 Arten: T-Rex, Triceratops, Stegosaurus, Brachiosaurus,
  Velociraptor, Ankylosaurus, Parasaurolophus, Spinosaurus, Pteranodon, Dilophosaurus.
- **Modi im Wechsel** (Standard: 3× Normal → 1× Spezial, abwechselnd):
  - **Boss-Ei:** riesig, gepanzert, mehr HP, 6 min Timer, garantiert mindestens Episch.
    Vorher 30 s „BOSS-EI in 30 s!“ – in der Zeit sammeln sich die Helfer.
  - **Ei-Duell:** zwei Eier. „1“ oder „2“ kommentieren = Team wählen. Andere Kommentare zählen fürs zuletzt
    gewählte Team (sonst zufällig). Das zuerst geschlüpfte Ei gewinnt, das Gewinnerteam wird eingeblendet.
- **Dynamische Schwierigkeit:** HP = (Basis + proNutzer · eff^Exponent) · Modus-Faktor mit
  eff = aktive² / (aktive + Kleingruppen-Bonus), alle 5 s angepasst (der Fortschritt in % bleibt erhalten).
  „Aktiv“ = in den letzten 60 s interagiert. Ziel: ein Schlüpfen alle 3–5 Minuten.
  Im Testmodus (60 % Aktivität) gemessen: 30, 150 und 500 Zuschauer ≈ 3 min pro Ei; 1 Zuschauer mit
  einem Kommentar alle ~20 s ≈ 3,5 min; 3 Zuschauer ≈ 2–2,5 min.
- **Hintergrund bewegt sich immer:** Lava-Höhle mit pulsierendem Lava-Licht, aufsteigender Glut,
  Staub in den Lichtkegeln, Flugsaurier-Silhouetten und der Herde (max. 15) auf dem Höhlenboden.
  Beim Boss-Ei blendet die Höhle in die violette Kristallhöhle über. Mini-Ereignisse alle 35–70 s:
  Tropfen von der Decke, Beben (Steinchen & Staub fallen), Lava-Ausbruch, Glühwürmchen, Falter,
  Herden-Parade, Flugsaurier-Schwarm, ein Dino stolpert. (Ohne Bilder: Wiese mit Tag-Nacht-Zyklus.)
- **Wiederkehrer:** Herde, Gesamt-Bestenliste, Sammlung pro Nutzer und Dino-Lexikon (10 Arten) bleiben
  gespeichert. Meilensteine wie „max_123 hat jetzt 5 Dinos benannt!“ oder „Erster legendärer Spinosaurus!“.
- **Sound:** alles per WebAudio erzeugt (Knacken, Risse, Schlüpf-Fanfaren je Seltenheit, Meteor, Einschlag,
  Ansagen-Jingles) plus dezente Eigenmusik. Lautstärken im Panel – bewusst leise, deine Stimme hat Vorrang.

---

## Einstellungen & Balancing

- **Im Panel** (Regler): Timer, HP-Formel, Schadenswerte, Seltenheiten, Rotation, Lautstärken, Regeln immer zeigen / Aufleuchten,
  Tag-Nacht-Dauer (nur Wiese), max. Helfer, Bilder-Look an/aus, und unter **„Action“**: Missionen an/aus, Abstand, Bonus, **Missions-Schwierigkeit**,
  Hype an/aus, Dauer, Schadens-Faktor, Sprechblasen an/aus, Abstand der Hintergrund-Ereignisse. Änderungen werden im Browser gespeichert („Einstellungen auf Standard“ setzt zurück).
- **Im Code:** Objekt `CONFIG` am Anfang von `game/index.html` – alle Werte mit Kommentar.
- **Balancing-Hilfe:** Panel zeigt „Ø Schlüpfzeit“; das Stream-Log (CSV) enthält Events/Minute,
  aktive Nutzer, Schlüpfzeiten und Einschläge.
  Faustregel: Eier schlüpfen zu langsam → „pro aktivem Nutzer“ senken; zu schnell → erhöhen.
  Kleine Runden schaffen es nicht → „Kleingruppen-Bonus“ erhöhen.
- Andere Bridge-Adresse/Port: Spiel mit `?bridge=ws://localhost:PORT` öffnen.

---

## Moderation

- **Kommentartexte werden nie angezeigt** – nur Namen (Ausnahme: „1“/„2“ im Duell).
- **Namensfilter** (deutsch + englisch, inkl. Leetspeak wie `h1tl3r`, `sch1ampe`, `f.u.c.k`) für alle
  eingeblendeten Namen → „Anonymer Knacker“. Namen werden auf 16 Zeichen gekürzt, unsichtbare Steuerzeichen entfernt.
  - Liste erweitern: im Panel unter „Eigenes Filterwort“ (wirkt sofort) oder dauerhaft in `BLOCKLIST` im Code.
- **Stummschalten:** Panel → „Zuletzt aktiv“ → „Stumm“. Stumme Nutzer zählen weiter, werden aber nirgends angezeigt
  (kein Helfer, kein Pop, nicht in Bestenlisten; benennen sie einen Dino, heißt er „Anonymer Knacker“).

### Profilbilder

- Erscheinen in der **Top-5-Bestenliste**, auf der **Schlüpf-Karte** (Namensgeber) und in **Dank/Begrüßungen**.
- Kommen über die Bridge (`http://localhost:8787/avatar/…`): sie lädt das Bild einmal von TikTok und hält es im Speicher.
  Darum gibt es Bilder nur, wenn das Spiel über `http://localhost:8787/` läuft. Ohne Bild erscheint ein farbiger
  Kreis mit dem Anfangsbuchstaben, im Testmodus ein erzeugtes Platzhalter-Gesicht.
- ⚠️ **Bilder werden nicht automatisch geprüft.** Schutz:
  - Panel → Einstellungen → Anzeige → **„Profilbilder anzeigen“** schaltet alle Bilder ab.
  - Panel → „Zuletzt aktiv“ → **„Bild aus“** blendet nur das Bild dieser Person aus (Name bleibt, wird gespeichert).
  - Stummgeschaltete und vom Namensfilter erwischte Nutzer bekommen nie ein Bild.
- Dinos in der Herde aus früheren Streams zeigen nur den Namen (TikTok-Bildlinks laufen ab).

---

## Daten, Speicherstand & Statistik

- Automatisches Speichern **alle 10 s** (localStorage): laufendes Ei inkl. HP & Timer, Herde, Bestenlisten,
  Sammlungen, Lexikon, Stummschaltungen. Nach Absturz/Neuladen geht es genau dort weiter.
- **Export/Import (JSON)** im Panel – z. B. vor dem Wechsel zwischen iPad-Test und PC oder als Backup.
  (localStorage gilt pro Adresse: `localhost:8787`, GitHub Pages und `file://` haben getrennte Spielstände.)
- **Stream-Log** pro Stream (CSV oder JSON im Panel): Zeitstempel, Events pro Minute (nach Typ),
  unique Nutzer, aktive Nutzer, Schlüpfzeiten, Meteor-Einschläge, Modus. Ein Stream gilt als beendet,
  wenn das Spiel 30 min nicht lief.
- „Alles zurücksetzen“ im Panel löscht Herde, Bestenlisten und Sammlungen (vorher exportieren!).

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Kein Ton | Einmal ins Spielbild klicken (Browser-Regel). In OBS: „Audio über OBS steuern“ aktivieren. Taste **M** prüfen. |
| Panel: „Bridge: nein“ | Läuft `start.bat`? Spiel über `http://localhost:8787/` öffnen. Firewall-Abfrage von Node erlauben. |
| „TikTok: kein LIVE gefunden / nicht live“ | Normal vor dem Livegang – die Bridge versucht es alle 30 s erneut. Sonst Benutzernamen in `bridge/.env` prüfen (ohne @). |
| „TikTok: Rate-Limit“ | Der kostenlose Signatur-Server ist ausgelastet. Etwas warten oder einen API-Key bei Euler Stream holen und als `SIGN_API_KEY` in `.env` eintragen. |
| „Port 8787 ist belegt“ | Bridge läuft schon (anderes Fenster schließen) oder `PORT=8788` in `.env` und Spiel mit `?bridge=ws://localhost:8788` öffnen. |
| Panel-Status springt / doppelte Events | Es sind zwei Spiel-Fenster offen (z. B. OBS + Chrome). Nur eins benutzen. |
| Testmodus zeigt Fake-Zuschauer im Stream | Passiert nur, solange nie eine Bridge verbunden war. Fällt die Bridge mitten im Stream aus, simuliert das Spiel absichtlich **keine** Zuschauer. „Testmodus erzwingen“ im Panel ausschalten. |
| Bild unscharf in LIVE Studio | Fenster größer ziehen oder OBS-Browserquelle (1080×1920) nutzen. |
| Ruckeln | Hardwarebeschleunigung im Browser/OBS aktivieren; andere Tabs schließen. FPS stehen im Panel. |
| Fenster minimiert → Spiel steht | Browser pausieren unsichtbare Fenster. Spiel-Fenster sichtbar lassen (darf hinter anderen liegen, nicht minimieren). |
| iPad: Bridge verbindet nicht | Erwartet – Safari blockiert `ws://` von der https-Seite. Die Bridge ist für den PC gedacht. |
| Spielstand weg | Anderer Browser/andere Adresse = anderer Speicher. Panel → Export/Import nutzen. |
| Keine Profilbilder, nur Buchstaben | Spiel über `http://localhost:8787/` öffnen (nicht GitHub Pages/Datei), Bridge muss laufen, „Profilbilder anzeigen“ im Panel an? Manche Nutzer haben kein Bild – dann bleibt der Buchstabe. |
| Wiese statt Höhle / gezeichnete Dinos | Bilder fehlen oder „Bilder-Look“ ist im Panel aus. Spiel über `http://localhost:8787/` oder GitHub Pages öffnen; bei Doppelklick auf die Datei muss der Ordner `game/assets` daneben liegen. Bridge nach einem Update neu starten. |
| TikTok hat etwas geändert | `cd bridge`, dann `npm update tiktok-live-connector`, Bridge neu starten, Log in `bridge/logs/` ansehen. |

---

### Bilder austauschen oder ergänzen

1. Neue Bilder (mit einfarbigem Magenta-Hintergrund #FF00FF oder transparent) unter dem gleichen Namen
   in den Ordner `Bilder/` legen, z. B. `dino_trex.png`, `egg_3.png`, `bg_cave.jpg`.
2. `python tools/prepare_assets.py` ausführen (braucht Python mit Pillow, numpy, scipy) –
   oder nur einzelne: `python tools/prepare_assets.py dino_trex egg_3`.
3. Spiel neu laden. Die Risse, das Glühen, alle Texte und Tafeln zeichnet das Spiel selbst.

---

*Spielidee und Umsetzung: eigenes Projekt. Bilder in `game/assets` wurden für dieses Spiel mit einer KI
erstellt; Sounds, Risse, Effekte und die Oberfläche werden zur Laufzeit erzeugt.*
