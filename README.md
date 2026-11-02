# Badge Studio

Estudio creativo web para badges LED redondos basados en chips Jieli (**E01**, E87, L8, X9, E92): el reemplazo libre de la app **Zrun** (HiBadge / Badgy), sin cuentas, sin publicidad y sin servidores. Todo corre en el navegador y se conecta al badge por **Web Bluetooth**.

> Abrí `index.html` desde un servidor HTTPS (o `localhost`) en Chrome, Edge u Opera. También hay una versión de un solo archivo en `dist/badge-studio.html`.

## Qué hace

| Área | Funciones |
| --- | --- |
| **Crear** | 33 animaciones procedurales en 4 familias · texto con 12 efectos, 6 tipografías, contorno y sombra · imagen con encuadre, zoom, pan, rotación, espejo, máscara y 8 filtros · GIF (recorte, FPS, reversa, boomerang) · video (inicio, velocidad) · secuencia de imágenes con fundido · código QR (versiones 1-10, ECC L/M/Q/H) · reloj (6 carátulas) · fondos sólidos, degradados o animados · stickers emoji animados · texto superpuesto · 6 marcos |
| **Pixel Lab** | Grillas 8/16/24/32, pincel, goma, balde, línea, rectángulo, cuentagotas, espejo, piel de cebolla, 4 paletas, hasta 48 cuadros, deshacer/rehacer, importar imagen como pixel art, exportar PNG |
| **Arcade** | Snake, Orbit Pong, Breakout, Flappy Badge y Esquivá con teclado, pad en pantalla y **control táctil** (deslizar, tocar, arrastrar). Grabación de 6 s de la partida como animación para el badge |
| **Materiales** | Galería de animaciones, 84 stickers, tus propias imágenes y GIF guardados localmente, importación por enlace y búsqueda en GIPHY con tu propia API key |
| **Mi colección** | Proyectos editables (con sus imágenes y GIF), AVI preparados, importación/exportación JSON y AVI |
| **Mi badge** | Conexión y autenticación RCSP, batería, info del dispositivo, almacenamiento, pantalla, brillo, idioma, sincronización de hora, **listado de archivos del badge con miniaturas y borrado**, diagnóstico de un clic, registro copiable |
| **Exportar** | AVI MJPEG con codificador JPEG propio (tablas Huffman estándar, solo JFIF: lo que el decodificador del chip Jieli reproduce bien), ajuste automático de calidad al límite de tamaño, GIF compartible, PNG |
| **Ajustes** | Tema claro/oscuro, resolución (368/360/240), prefijo de nombre, confirmación de envío, reconexión automática, PWA instalable y offline |

## Cómo usarlo

```bash
node tools/serve.js        # http://localhost:8080  (Web Bluetooth funciona en localhost)
```

1. **Crear → Preparar para el badge**: se genera el AVI. Mirá el tamaño; 900 KB es el límite seguro para un envío rápido.
2. **Conectar badge**: poné el badge en modo Bluetooth (botón BT) y elegí `E01…` en el selector.
3. **Enviar al badge**: el badge pide los datos por ventanas, confirma el nombre (8.3) y cierra. La miniatura queda asociada al archivo.
4. **Mi badge → Archivos**: tocá *Actualizar* para listar lo que hay en el badge y *Borrar* para eliminar.

Sin Web Bluetooth (Safari, Firefox, iPhone) podés crear y descargar el AVI, y enviarlo luego desde Chrome en Android, Windows, macOS o ChromeOS.

## Estructura

```
index.html            interfaz (sin build, scripts clásicos)
css/app.css           estilos, tema claro/oscuro, responsive
js/core.js            utilidades (CRC16, nombres 8.3, color, ruido)
js/jl-auth.js         cifrado de autenticación Jieli (libjl_auth)
js/jpeg.js            codificador JPEG baseline (tablas estándar)
js/avi.js             constructor y validador RIFF AVI MJPEG
js/gif.js             decodificador y codificador GIF
js/rcsp.js            tramas RCSP (AE00) y Qix (FD00), TLV, archivos
js/badge-client.js    cliente Web Bluetooth: auth, envío, lectura, borrado, ajustes
js/qr.js              generador de códigos QR
js/patterns.js        33 animaciones procedurales
js/textfx.js          efectos de texto y leyenda superpuesta
js/clock.js           carátulas de reloj
js/scene.js           compositor (fondo, contenido, stickers, texto, marco)
js/pixel.js           modelo del editor de píxeles
js/games.js           arcade con control táctil
js/db.js              IndexedDB (proyectos, materiales, miniaturas, badges)
js/app.js             shell de la aplicación
tools/build.js        genera dist/badge-studio.html (un solo archivo)
tools/serve.js        servidor estático local
tools/smoke.js        prueba de humo con Playwright (capturas en dist/screenshots)
tests/                pruebas Node (códecs, protocolo, badge simulado)
docs/                 PROTOCOL.md · RESEARCH.md · GAMES-ON-BADGE.md
```

```bash
npm test        # 18 pruebas: cifrado, CRC, JPEG, AVI, GIF, RCSP, badge simulado (auth, envío, listado, borrado, Qix)
npm run build   # dist/badge-studio.html
npm run smoke   # Playwright: recorre todas las páginas, prepara un AVI, dibuja, juega
```

## Investigación

Se compararon seis proyectos y el SDK oficial de Jieli para quedarnos con lo mejor de cada uno; el detalle está en [docs/RESEARCH.md](docs/RESEARCH.md) y el protocolo resultante en [docs/PROTOCOL.md](docs/PROTOCOL.md).

- **AuraCast** (Manaiakalani): 30 patrones, modos GIF/QR/secuencia, canal Qix (batería, pantalla, brillo, idioma), relay, PWA.
- **web-bluetooth-e87** (hybridherbst): handshake de autenticación, framing FE DC BA, CRC-16/XMODEM, ventanas de 490 B.
- **jieli-ble-badge-research** (ElectronicCats): hardware (AC707N/BR35, 360×360), OTA y firmware propio con LVGL táctil.
- **E-Badge Studio** (samascience): reglas JPEG baseline/JFIF/sin restart markers para el decodificador Jieli.
- **Badge Magic** (FOSSASIA): biblioteca de clipart, modos de desplazamiento, varios slots.
- **fw-AC63_BT_SDK** y **Android-JL_Bluetooth** (Jieli-Tech): tabla oficial de opcodes RCSP, estructura `FileStruct`, `PathData`, `DelDevFileParam` y `DeleteFileByNameCmd`.

## Juegos en el badge

El firmware de fábrica solo reproduce medios: los juegos se juegan en el estudio (con táctil) y la partida grabada se envía como animación. Para correr juegos con la pantalla táctil **dentro** del badge hace falta un firmware propio; el camino conocido está en [docs/GAMES-ON-BADGE.md](docs/GAMES-ON-BADGE.md).

## Licencia

MIT. Las tablas del cifrado de autenticación provienen de la implementación validada en el E01; el formato de los comandos de archivos proviene de los SDK públicos de Jieli (Apache-2.0).
