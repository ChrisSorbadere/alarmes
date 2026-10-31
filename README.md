# Alarmes

Appli Android d'alarmes sur mesure : dates choisies sur un calendrier, répétitions avec exceptions, import d'un fichier de dates (Excel, CSV, .ics), description complète affichée en plein écran, photos, contact, lieu, couleur d'urgence.

- `docs/` : l'appli (HTML/CSS/JS), embarquée dans l'APK
- `android/` : projet Android (Capacitor) avec le module natif d'alarmes (`AlarmNativePlugin`, `AlarmReceiver`, `AlarmActivity`)
- `.github/workflows/apk.yml` : compile l'APK à chaque envoi sur `main` et le publie dans **Releases**

## Installer
Ouvrir la page **Releases** du dépôt sur le téléphone, télécharger le dernier `Alarmes-….apk`, l'ouvrir et autoriser l'installation.

## Mettre à jour
Modifier `docs/`, incrémenter `VERSION` dans `docs/app.js`, pousser : l'APK suivant s'installe par-dessus (même clé de signature, stockée dans les secrets GitHub du dépôt).
