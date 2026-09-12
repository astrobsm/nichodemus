# Installation and deployment

**Nichodemus Ugbor Memorial Community Health Outreach Management System**

This application is offline-first. Once it is on a phone it needs no internet,
no mobile data and no server. Everything below is only about getting it onto
the device in the first place.

There are two routes. Both are one command.

| Route | Command | Gives you |
| --- | --- | --- |
| **A — Android app** | `npm run apk` | A real `.apk` file you install like any app |
| **B — Browser install** | `npm run serve` | The app added from Chrome, no Android tooling needed |
| **C — Desktop** | `npm run desktop:build` | A Windows installer for a laptop or office machine |

For hosting the application on Vercel and syncing several devices through a
free cloud database, see **[CLOUD.md](CLOUD.md)**.

Route A produces the more familiar result. Route B needs nothing but a laptop
and Wi-Fi, and is the fallback when a phone blocks sideloading.

---

## Route A — build the Android app

```bash
npm install      # once
npm run apk
```

That single command does all of this:

1. Builds the web application.
2. Finds your JDK and Android SDK (you do not set `JAVA_HOME` or `ANDROID_HOME`).
3. Creates the Android project the first time, and reuses it afterwards.
4. Configures Gradle to fetch a matching Java toolchain if yours is older.
5. Generates the launcher icons.
6. Runs Gradle.
7. Copies the finished APK into `release/` with a dated name.

Result:

```
release/nug-outreach-1.0.0-debug-20260912.apk
```

### Putting it on the phone

**Over USB**, with the phone plugged in and USB debugging enabled:

```bash
npm run apk -- --install
```

**By hand:** copy the `.apk` to the phone however you like — cable, memory
card, Bluetooth — then tap it in the Files app. Android will ask permission to
install from this source; allow it. The app appears as **NUG Outreach**.

### What you need for Route A

| | |
| --- | --- |
| **JDK 21 or newer** | `winget install Microsoft.OpenJDK.21` (Windows), `brew install --cask temurin` (macOS), or [adoptium.net](https://adoptium.net) |
| **Android SDK** | [Command line tools](https://developer.android.com/studio#command-line-tools-only), then `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` and `sdkmanager --licenses` |

Android Studio is **not** required. If either is missing, `npm run apk` stops
and tells you exactly what to install.

> **The first build is slow** — Gradle, the Android plugin and possibly a Java
> toolchain are downloaded once, which can take fifteen minutes or more and
> needs a working internet connection. Later builds take about a minute. If the
> first attempt dies partway through on a download, just run it again: Gradle
> keeps what it already fetched.

### Release build

```bash
npm run apk -- --release
```

Produces an **unsigned** release APK. To distribute it outside your own team
you must sign it with your own keystore:

```bash
keytool -genkey -v -keystore nug.keystore -alias nug \
        -keyalg RSA -keysize 2048 -validity 10000

"$ANDROID_HOME/build-tools/35.0.0/apksigner" sign \
        --ks nug.keystore \
        --out nug-outreach-signed.apk \
        release/nug-outreach-1.0.0-release-unsigned-*.apk
```

For an outreach team installing on their own devices, the debug build from
`npm run apk` is simpler and works exactly the same.

---

## Route B — install from the browser

No Android SDK, no JDK, no cable required.

```bash
npm run build
npm run serve
```

It prints the address to type on the phone:

```
    http://192.168.1.23:4173        (Wi-Fi)
```

On the phone: connect to the same Wi-Fi, open Chrome, go to that address, then
**menu (⋮) → Add to Home screen**.

Turn Wi-Fi off and open it again to prove it works offline. It will.

### Getting the proper "Install app" prompt

Chrome only offers a real installation on a secure origin, which a plain
`http://192.168.x.x` address is not. With a USB cable you can get one:

```bash
npm run serve -- --usb
```

This uses `adb reverse` so the phone treats `http://localhost:4173` as its own
address, which does count as secure. On the phone, open that address and choose
**menu (⋮) → Install app**.

The difference is cosmetic — both work fully offline — but the installed
version looks and launches more like a native app.

### Or host it once

Upload `dist/` to any static host (GitHub Pages, Netlify, a hospital web
server). Open it on the phone once and install. After that the phone never
contacts the host again.

This is only a delivery mechanism. No patient data goes to that host, or
anywhere else, ever.

---

## First launch

On first open the application shows the setup wizard:

1. **Project details** — pre-filled with the Nichodemus Ugbor Memorial outreach
   at Umunna community, Umuhu village, Owelli Court, Awgu LGA, Enugu State on
   29 December 2026, 500 expected
   participants. Every field is editable.
2. **Administrator account** — you create the username and PIN. There is no
   default password in this application.
3. **Security** — application lock timeout and backup reminder interval.
4. **Clinical setup** — theme, objectives, directors. Alert thresholds are
   pre-loaded and reviewable in Settings.
5. **Referral facility** — the main destination you will refer people to.
6. **Confirm** — optionally load demonstration data for training.

The wizard creates the database, nine stations, the 19-item event checklist,
the logistics list and 15 budget categories.

---

## Where the data lives

| Platform | Storage |
| --- | --- |
| Android app (APK) | OPFS inside the app's private storage |
| Chrome on Android, desktop Chrome/Edge | OPFS — a real SQLite file in the browser's private filesystem |
| Anything without OPFS | IndexedDB, one record holding the database image |

Settings → About shows which is in use and how large the database is.

On first launch the application asks the operating system to mark its storage
**persistent**, so the clinical database is not evicted when the device runs
low on space.

### What this means in practice

- The database survives closing the app, restarting the phone and running out
  of battery.
- Uninstalling the app, or clearing Chrome's site data, deletes it.
  **This is why backups matter.** Take one before the outreach and several
  during it.

### Where saved files go

Backups, PDF reports and CSV exports are written to:

| | |
| --- | --- |
| Android app | `Documents/NUG Outreach` — and the share sheet opens for backups, so you can send one straight to another device |
| Chrome on Android | the Downloads folder |
| Desktop browser | a folder you choose — USB stick, SD card, anywhere |

---

## Preparing devices for the outreach

The day before:

- [ ] App installed on every device that will be used.
- [ ] Each device opened once in aeroplane mode, to prove it runs offline.
- [ ] One device nominated as the **master** — the one holding the real database.
- [ ] User accounts created for everyone entering data (Settings → Users).
- [ ] Each person signed in once and set their own PIN.
- [ ] Clinical thresholds reviewed and approved by the medical director.
- [ ] Referral facilities entered with working telephone numbers.
- [ ] Inventory loaded with opening stock.
- [ ] A backup taken and copied off the device.
- [ ] Demonstration data cleared, if it was used for training.

> **Version 1 runs on a single device.** Multiple devices each keep their own
> separate database; there is no synchronisation between them yet. Use one
> device for the real record, and keep the others for planning modules or in
> demonstration mode.

---

## Updating

**Android app:** run `npm run apk` again and install the new APK over the old
one. Installing over the top keeps the database.

**Browser install:** rebuild, re-serve, and open the app once with the laptop
reachable. The service worker picks up the new version and activates it on the
next launch.

**Updating never touches the database.** Migrations run automatically at
startup and are recorded in `schema_migrations`. Take a backup before updating
anyway.

---

## Uninstalling

Take a backup first. Then remove the app. The database goes with it and cannot
be recovered without the backup file.

---

## If the build fails

| Message | What to do |
| --- | --- |
| `No Java Development Kit found` | Install JDK 21 (see Route A above) |
| `Java 17 found, but Java 21 or newer is required` | Install JDK 21; the script finds it by itself afterwards |
| `No Android SDK found` | Install the command line tools, or use Route B |
| `The Android SDK has no platform installed` | `sdkmanager "platforms;android-35" "build-tools;35.0.0"` |
| Gradle fails downloading something | Network problem. Run `npm run apk` again — Gradle keeps what it already has |
| `licences not accepted` | `sdkmanager --licenses` and accept |

None of this affects the application itself. If Android tooling is more trouble
than it is worth on a given machine, Route B produces the same offline app with
nothing but Node and a browser.
