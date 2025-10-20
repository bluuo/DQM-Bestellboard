# DQM-Bestellboard

Produktionsreifes Beispielprojekt für ein öffentliches Bestellboard auf Basis von Firebase Firestore und Cloud Functions. Die statische Web-App ist für GitHub Pages optimiert, während Firestore-Rules und Functions über GitHub Actions nach Firebase deployt werden können.

## Projektstruktur

```
├── .firebaserc
├── firebase.json
├── firestore.rules
├── functions/
│   ├── index.js
│   ├── package.json
│   └── .eslintrc.js
├── web/
│   ├── admin.html
│   ├── admin.js
│   ├── app.js
│   ├── config.js
│   ├── index.html
│   └── styles.css
└── .github/workflows/
    ├── deploy-firebase.yml
    └── deploy-pages.yml
```

## Features

- **Öffentliches Bestellboard** ohne Login – Geräte werden per `geraeteId` aus dem LocalStorage identifiziert.
- **Realtime Firestore Listener** für Produkte und Bestellungen.
- **Preis-Snapshots & Summen** werden beim Speichern berechnet und gespeichert.
- **Optionen-Engine** für Single- und Multi-Select-Konfigurationen mit Preisaufschlägen.
- **Admin-Oberfläche** (admin.html) nutzt Callable Cloud Functions (`adminUpsertProdukt`, `adminDeleteProdukt`) mit Token-Validierung.
- **Firestoreregeln**: Öffentliche Reads, schreibende Operationen nur für eigene Bestellungen, Produktänderungen nur via Functions.
- **CI/CD**: Automatisierte Deployments nach GitHub Pages (Frontend) und Firebase (Rules & Functions) via GitHub Actions.

## Lokale Einrichtung

1. Repository klonen und in das Projekt wechseln.
2. Firebase-Projekt-ID in `.firebaserc` setzen.
3. Firebase CLI installieren und konfigurieren:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use <DEIN-FIREBASE-PROJEKT-ID>
   ```
4. Admin-Token konfigurieren (für Cloud Functions):
   ```bash
   firebase functions:config:set admin.token="GEHEIMES_ADMIN_TOKEN"
   ```
5. Functions-Abhängigkeiten installieren:
   ```bash
   cd functions
   npm install
   ```
6. Firebase Web-Konfiguration (`firebaseKonfiguration`) in `web/config.js` eintragen. Die Werte erhältst du, indem du in der Firebase Console unter Projekteinstellungen → Allgemein im Bereich **Deine Apps** eine neue Web-App registrierst (Symbol `</>`). Nach dem Anlegen zeigt dir Firebase einen Code-Snippet mit `apiKey`, `authDomain`, `projectId`, `appId` usw. an – kopiere diese Werte in `web/config.js`. Der dort aufgeführte API Key ist ausschließlich für Firebase-Services bestimmt und darf im Frontend stehen.

### Firebase-Web-App & API-Key anlegen

Falls du noch keinen API-Key siehst, hast du wahrscheinlich noch keine Web-App in deinem Firebase-Projekt erstellt. Gehe dazu wie folgt vor:

1. Öffne die Firebase-Konsole und wähle dein Projekt aus.
2. Navigiere zu **Projekteinstellungen** → **Allgemein**.
3. Klicke im Abschnitt **Deine Apps** auf das Web-Symbol (`</>`) und registriere eine neue App. Einen Hosting-Schritt kannst du überspringen.
4. Nach dem Abschluss blendet Firebase den Konfigurations-Snippet mit `apiKey` und den restlichen Feldern ein. Kopiere die Werte in `web/config.js`.
5. Solltest du die Werte später erneut benötigen, findest du sie jederzeit wieder in den Projekteinstellungen.

Firebase-API-Keys für Web-Apps sind automatisch auf Firebase-Services beschränkt und dürfen in öffentlichen Repositories verwendet werden. Die Sicherheitslogik basiert auf Firestore-Rules sowie den Cloud Functions.

## Firestore Collections & Datenmodell

### `produkte`

| Feld                       | Typ     | Beschreibung                                       |
|----------------------------|---------|----------------------------------------------------|
| `produktName`              | string  | Anzeigename des Produkts (Pflichtfeld).            |
| `produktBeschreibung`      | string  | Optionale Beschreibung.                            |
| `produktPreisBrutto`       | number  | Preis pro Einheit (Pflichtfeld).                   |
| `waehrungCode`             | string  | ISO-4217 Code, Standard `EUR`.                     |
| `produktKategorie`         | string  | Optionale Kategorie.                               |
| `produktAktiv`             | boolean | Steuerung der Sichtbarkeit.                        |
| `optionenDefinition`       | object  | Definition von Optionsgruppen (siehe unten).       |
| `erstelltAm` / `aktualisiertAm` | timestamp | Automatische Timestamps.                    |

Beispiel für `optionenDefinition`:

```json
{
  "gruppen": [
    {
      "id": "sauce",
      "label": "Sauce",
      "typ": "single",
      "werte": [
        { "label": "Ketchup", "preisDelta": 0.0 },
        { "label": "BBQ", "preisDelta": 0.2 }
      ]
    },
    {
      "id": "extras",
      "label": "Extras",
      "typ": "multi",
      "werte": [
        { "label": "Zwiebeln", "preisDelta": 0.1 },
        { "label": "Käse", "preisDelta": 0.4 }
      ]
    }
  ]
}
```

### `bestellungen`

| Feld                       | Typ      | Beschreibung                                                  |
|----------------------------|----------|---------------------------------------------------------------|
| `bestellerName`            | string   | Anzeigename der bestellenden Person.                          |
| `geraeteId`                | string   | Zufällig pro Gerät (LocalStorage).                            |
| `produktId`                | string   | Referenz auf Produkt.                                         |
| `produktNameSnapshot`      | string   | Snapshot des Namens zur Historisierung.                       |
| `produktPreisBruttoSnapshot` | number | Snapshot des Einzelpreises.                                  |
| `produktWaehrungSnapshot`  | string   | Snapshot der Währung.                                         |
| `produktOptionenSnapshot`  | array    | Liste gewählter Optionen inkl. Preis-Deltas.                  |
| `optionenAuswahl`          | array    | Strukturiert für Formular-Roundtrip.                          |
| `menge`                    | number   | Bestellte Menge.                                              |
| `einzelpreisBerechnet`     | number   | Preis je Einheit inkl. Optionen.                              |
| `gesamtpreisBerechnet`     | number   | Gesamtpreis (Einzelpreis × Menge).                            |
| `kommentar`                | string   | Optionaler Kommentar.                                         |
| `archiviert`               | boolean  | Bei „Löschen“ auf `true` gesetzt, UI blendet aus.             |
| `erstelltAm` / `aktualisiertAm` | timestamp | Automatische Timestamps.                               |
| `archiviertAm`             | timestamp | Zeitpunkt der Archivierung (optional).                        |

## Firestore Security Rules

- Öffentliche Lesezugriffe auf `produkte` und `bestellungen`.
- `produkte`: keine direkten Schreibrechte – ausschließlich via Cloud Functions mit Admin-Token.
- `bestellungen`: Geräte dürfen nur eigene Dokumente anlegen/aktualisieren. „Löschen“ wird als Update (`archiviert = true`) umgesetzt.

## GitHub Actions Workflows

### `deploy-pages.yml`

- Build-Step lädt alle Dateien aus `web/` als Artefakt hoch.
- Deployment-Step veröffentlicht sie auf GitHub Pages.
- Trigger: Push auf `main` und manueller Dispatch.

### `deploy-firebase.yml`

- Installiert Abhängigkeiten der Functions.
- Führt `npm run lint` in `functions/` aus.
- Deployt Firestore-Regeln und Functions (`firebase deploy --only firestore:rules,functions`).
- Erwartet GitHub Secrets:
  - `FIREBASE_SERVICE_ACCOUNT` (JSON des Service Accounts mit `Firebase Admin` Rolle).
  - `FIREBASE_PROJECT_ID` (Project ID).

## Deployment-Anleitung

1. Secrets und Umgebungsvariablen laut obigen Abschnitt in GitHub konfigurieren.
2. Workflow-Dateien prüfen und ggf. Projekt-ID/Region anpassen.
3. Änderungen in `web/config.js` committen (API-Keys etc. können öffentlich sein, solange Firestore-Rules greifen).
4. Push auf `main` auslösen → GitHub Actions übernimmt Deployments.

## Entwicklungshinweise

- Variablennamen und Funktionen sind bewusst auf Deutsch in `camelCase` gehalten.
- Frontend nutzt moderne Browser-APIs (Intl, Fetch, Web Crypto). Für Legacy-Browser sind ggf. Polyfills erforderlich.
- Summenanzeige verwendet `standardWaehrungCode` aus `config.js`. Bei Mischwährungen empfiehlt sich eine Erweiterung.
- „Löschen“ archiviert Bestellungen. Ein geplanter Cleanup (z.B. per Cloud Function Cron) kann archivierte Einträge endgültig entfernen.

Viel Erfolg beim Anpassen und Deployen! 🎉
