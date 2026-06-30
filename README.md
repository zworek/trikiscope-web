# TrikiScope Web

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bootstrap 5.3](https://img.shields.io/badge/Bootstrap-5.3-7952B3.svg)](https://getbootstrap.com/)
[![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-API-4285F4.svg)](https://developer.chrome.com/docs/capabilities/bluetooth)
[![PWA](https://img.shields.io/badge/PWA-offline%20ready-5A0FC8.svg)](https://web.dev/progressive-web-apps/)

**[▶ Uruchom aplikację online](https://zworek.github.io/trikiscope-web/)**

Przeglądarkowy oscyloskop BLE dla kapsla **Żabka Triki** — port projektu
[TrikiScope](https://github.com/Maku-hub/TrikiScope) (Python/TUI) do Web Bluetooth API.
Zawiera manifest PWA i service worker — po załadowaniu z HTTPS można zainstalować ją jako aplikację i używać offline.

> **Uwaga:** Projekt jest w znacznej mierze _vibe-coded_ — pisany szybko, z pomocą AI,
> bez głębokiego przeglądu każdej linii. Działa, ale traktuj kod jako punkt wyjścia,
> nie jako wzorzec produkcyjny.

## Co pokazuje

- **Oscyloskop** — kanwas w czasie rzeczywistym z trzema panelami: akcelerometr (X/Y/Z), żyroskop (X/Y/Z) oraz cyfrowy kanał przycisku (wykres schodkowy); oś czasu 1–30 s
- **Orientacja 3D** — obracający się model kapsla napędzany filtrem **Madgwick AHRS**, kąty pitch/roll/yaw, auto-kalibracja przy starcie strumienia
- **Detekcja gestów** — TAP/IMPACT, FREE-FALL, SHAKE, SPIN z wizualnym podświetleniem
- **Paski sensorów** — wartości na żywo wszystkich sześciu osi plus magnitudy |a| i |ω|
- **LED** — sterowanie diodą na kapslu (toggle)
- **Nagrywanie CSV** — zapis strumienia IMU do pliku (frame index, timestamp, gyro, accel, kąty, przycisk)
- **Gry** — zakładka z minigrami sterowanymi fizycznym kapslem:
  - **Gunslinger** — zareaguj na sygnał LED tak szybko jak możesz (pomiar w ms)
  - **Catch an Egg** — rzuć kapslem jak najwyżej i złap jak najdelikatniej (czas lotu × jakość złapania)
- **PWA** — instalowalny jako aplikacja desktopowa/mobilna, pełen offline dzięki service workerowi

## Wymagania

Wymaga przeglądarki z Web Bluetooth API:

| Przeglądarka | Status |
|---|---|
| Chrome 56+ (desktop) | ✅ |
| Edge 79+ (desktop) | ✅ |
| Chrome for Android 56+ | ✅ |
| Safari / Firefox | ❌ brak obsługi Web Bluetooth |

Aplikacja musi być serwowana przez **HTTPS lub `localhost`** — jest to wymaganie Web Bluetooth API oraz service workera.

## Uruchomienie

```bash
# Opcja 1 — npm (polecane)
npm run serve       # http://localhost:8080

# Opcja 2 — Python
python -m http.server 8080

# Opcja 3 — dowolny serwer plików statycznych
npx serve . -p 8080
```

Następnie otwórz **http://localhost:8080** w Chrome lub Edge.

> Kapsel śpi po dłuższej bezczynności — naciśnij przycisk na kapslu tuż przed kliknięciem **Connect**, by go wybudzić.

## Instalacja jako aplikacja (PWA)

Po załadowaniu z HTTPS (nie `localhost`) Chrome/Edge mogą pokazać ikonę **⊕** w pasku adresu
lub opcję „Zainstaluj aplikację" w menu przeglądarki. Po zainstalowaniu aplikacja otwiera się
w trybie standalone i jest dostępna offline.

Na `localhost` service worker działa (cache, offline), ale przycisk instalacji zwykle się nie pojawia.

## Użytkowanie

1. Wybierz **ODR** (domyślnie 208 Hz) — można zmienić tylko przed połączeniem
2. Naciśnij **Connect** i wybierz „Triki" z systemowego dialogu BLE
3. Przełączaj między zakładkami **Oscilloscope** i **🎮 Games** — połączenie BLE pozostaje aktywne

**Oscyloskop:**
- Przytrzymaj kapsel nieruchomo przez ~1 s — auto-kalibracja zeruje orientację
- **Reset zero** — zeruje orientację ponownie w dowolnym momencie
- **LED** — zapala/gasi diodę na kapslu
- **Pause / Clear** — zatrzymuje / czyści oscyloskop
- **● Record → ↓ Download** — nagrywa strumień IMU i pobiera plik CSV

**Gry:**
- Wybierz grę z menu, a następnie graj używając fizycznego przycisku na kapslu
- Przycisk na kapslu służy jako start/akcja w obu grach

### ODR (Output Data Rate)

| Wybór | Częstotliwość | Zastosowanie |
|---|---|---|
| 52 Hz | ~52 próbki/s | Wolne ruchy, oszczędność |
| 104 Hz | ~104 próbki/s | Ogólne |
| **208 Hz** | **~208 próbki/s** | **Domyślne** |
| 416 Hz | ~416 próbki/s | Szybkie gesty |
| 833 Hz | ~833 próbki/s | Precyzyjne pomiary |
| 1666 Hz | ~1666 próbki/s | Maksymalna rozdzielczość |

## Architektura

```
trikishow-scope/
├── triki.js          Biblioteka BLE: TrikiDevice, FrameParser, MadgwickAHRS,
│                     VisualOrientationMapper, GestureDetector, ODR_PRESETS
├── app.js            Punkt wejścia SPA: wspólne BLE UI, nawigacja między widokami
├── scope.js          Widok oscyloskopu: kanwas, nagrywanie CSV, paski sensorów
├── games.js          Widok gier: Gunslinger, Catch an Egg
├── index.html        Interfejs (Bootstrap 5.3 dark, SPA)
├── style.css         Style własne: 3D box, paski sensorów, piguły gestów, gry
├── sw.js             Service worker (cache-first, pełen offline)
├── manifest.json     Manifest PWA
├── icon.svg          Ikona aplikacji (SVG)
├── icon-192.png      Ikona PWA 192×192
├── icon-512.png      Ikona PWA 512×512
├── package.json      Skrypty npm (serve / dev)
└── vendor/
    ├── bootstrap.min.css         Bootstrap 5.3.3 (lokalnie, bez CDN)
    └── bootstrap.bundle.min.js
```

Żadnych bundlerów, żadnych zależności npm do zainstalowania — plik `package.json`
zawiera tylko skrypty do serwowania. Bootstrap jest zaszytym vendorem żeby działać offline od pierwszego uruchomienia.

## Podstawa — TrikiScope

`triki.js` to port JavaScriptowy modułów Pythona z projektu
[TrikiScope](https://github.com/Maku-hub/TrikiScope):

| Klasa JS | Źródło Python (TrikiScope) |
|---|---|
| `FrameParser` | `trikiscope/protocol.py` |
| `MadgwickAHRS` | `trikiscope/orientation.py` |
| `VisualOrientationMapper` | `trikiscope/orientation.py` |
| `GestureDetector` | `trikiscope/gestures.py` |
| `ODR_PRESETS` | `trikiscope/config.py` |

Pełna specyfikacja BLE — format ramek, UUID usług i charakterystyk, sekwencja
startowa, sterowanie LED, obsługa przycisku — jest udokumentowana w projekcie
[TrikiScope](https://github.com/Maku-hub/TrikiScope#specyfikacja-ble).

## Protokół BLE (skrót)

Urządzenie korzysta z **Nordic UART Service (NUS)**:

- TX (powiadomienia): `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
- RX (zapis komend): `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- LED: `6e400004-b5a3-f393-e0a9-e50e24dcca9e` (zapis: `01` = świeci, `00` = zgaszona)

Ramka IMU — 14 bajtów: `[0x22][btn: 0x00/0x01][gyroX LE][gyroY LE][gyroZ LE][accelX LE][accelY LE][accelZ LE]`.  
Skala: żyroskop ÷ 131,0 → deg/s, akcelerometr ÷ 2048,0 → g.

## Zastrzeżenie

Projekt edukacyjny / narzędziowy. Nie jest powiązany z firmą Żabka Polska.

## Licencja

MIT — patrz [LICENSE](LICENSE).
