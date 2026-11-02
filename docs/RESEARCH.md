# Investigación: qué se tomó de cada proyecto

Objetivo: reemplazar la app **Zrun** (`com.zijun.zrun`, Shenzhen Zijun Technology; también distribuida como HiBadge y Badgy) con una app web libre que cubra todo lo que hace Zrun y mejore la experiencia. Zrun en Google Play se describe como app de smartwatch, con reseñas mixtas: conexión inestable, anuncios, soporte de GIF confuso. Sus pantallas para badges son: dispositivo (conectar, batería), DIY (imagen, GIF, video, texto), materiales en línea (GIPHY/Tenor), lista de contenido en el badge con borrado, ajustes (brillo, idioma, hora).

## Proyectos comparados

| Proyecto | Qué aporta | Qué se adoptó |
| --- | --- | --- |
| [Manaiakalani/auracast](https://github.com/Manaiakalani/auracast) · MIT · Svelte 5 | App web para E87/L8/X9/E92: 30 patrones, imagen, GIF, texto con 8 efectos, video, QR, secuencias, batería/brillo/diagnóstico, relay Python para Safari, PWA. Documenta el canal Qix (FD02) y el flujo de ventanas. | Modos GIF/QR/secuencia, efectos de texto, canal Qix (batería 0x29, pantalla 0xC6, idioma 0x16, brillo 0x20), diagnóstico de un clic, PWA, estructura de patrones por familias, límite de 900 KB con ajuste de calidad. Se corrigió su parser de listado (las entradas no viajan en la respuesta de 0x0C) y el endianness de `pathLen`. |
| [hybridherbst/web-bluetooth-e87](https://github.com/hybridherbst/web-bluetooth-e87) · MIT | Primer uploader web; ingeniería inversa de `libjl_auth.so`, framing FE DC BA, CRC-16/XMODEM, ventanas de 8×490 B, capturas btsnoop. | Confirmación del handshake y del formato de tramas; constante de chunk 490; respuesta UTF-16LE de 0x20 para el perfil E87. |
| [ElectronicCats/jieli-ble-badge-research](https://github.com/ElectronicCats/jieli-ble-badge-research) | Hardware real (AC707N/BR35, 360×360 RGB565, táctil AXS5106L, 4 MB NOR), OTA por BLE, firmware propio con LVGL, HID, escáner BLE. | Perfil de hardware, ruta documentada para juegos en el badge (`docs/GAMES-ON-BADGE.md`), opcodes Qix de información. |
| [samascience/ebadge](https://github.com/samascience/ebadge) | Badge BW03 (AC7076A, 240×240) con protocolo distinto (0xCD). Reglas de JPEG para el decodificador Jieli: baseline, JFIF, alineado a MCU, sin restart markers. | Codificador JPEG propio con tablas estándar; resolución 240 como opción; mensajes de estado (carga, batería baja, espacio). |
| [fossasia/badgemagic-app](https://github.com/fossasia/badgemagic-app) | App multiplataforma para badges 11×44 de texto: clipart, modos de desplazamiento, varios slots, dibujo. | Biblioteca de stickers/clipart, marquesina y desplazamiento vertical, varios proyectos guardados. |
| [Jieli-Tech/fw-AC63_BT_SDK](https://github.com/Jieli-Tech/fw-AC63_BT_SDK) y [Jieli-Tech/Android-JL_Bluetooth](https://github.com/Jieli-Tech/Android-JL_Bluetooth) · Apache-2.0 | SDK oficial: tabla `JL_OPCODE_*`, clave de enlace, `PathData`, `FileStruct`, `DelDevFileParam`, `DeleteFileByNameCmd`, `DevStorageInfo`. | Listado real de archivos (DATA 0x0C + STOP 0x0D), borrado por clúster (0x1F) y por nombre (0x23), tabla de almacenamientos, nombres de atributos TLV. Nunca se usa 0x22 (formateo). |

## Decisiones

- **Sin build ni dependencias**: scripts clásicos bajo el espacio `BS`, servidos como estáticos o inlinados en un solo HTML (`tools/build.js`). Cualquier badge nuevo solo necesita ajustar `NAME_PREFIXES`.
- **Ruta de envío validada primero**: el flujo E01 del archivo original se mantiene byte a byte; todo lo nuevo (Qix, listado, borrado, brillo) es opcional y tolerante a `NOT_SUPPORTED`.
- **Codificador JPEG propio** en lugar de `canvas.toBlob`: evita las tablas Huffman optimizadas y los segmentos ICC/EXIF que el chip no decodifica bien, y permite bajar la calidad hasta entrar en el límite elegido.
- **Decodificador GIF propio** con `ImageDecoder` (WebCodecs) como vía rápida: funciona también en navegadores sin WebCodecs y en Node para pruebas.
- **Badge simulado** en las pruebas (`tests/helpers/sim-badge.js`): reproduce auth, ventanas de lectura, renombrado, listado por DATA, borrado y canal Qix para que el cliente se pruebe sin hardware.
- **Juegos**: táctil completo en el estudio (deslizar, tocar, arrastrar, pad); en el badge solo con firmware propio.

## Zrun → Badge Studio

| Zrun | Badge Studio |
| --- | --- |
| Añadir dispositivo, elegir modelo | Selector Web Bluetooth con prefijos conocidos, perfil automático E01/E87, reconexión al último badge |
| DIY imagen (recorte cuadrado) | Encuadre, zoom, pan, rotación, espejo, máscara circular, filtros, fondo, stickers, texto, marco |
| DIY GIF (GIPHY/Tenor) | GIF local, por enlace, GIPHY con tu key, recorte, FPS, reversa, boomerang |
| DIY video ≤ 15 s | Inicio, velocidad, duración hasta 15 s, límite de tamaño con calidad automática |
| Texto | 12 efectos, 6 tipografías, dos líneas, contorno, sombra, arcoíris |
| Materiales en línea | 33 animaciones generadas, 84 stickers, reloj, QR, pixel art, arcade |
| Lista de contenido + borrar | Listado RCSP con miniaturas de lo enviado, borrado individual o total |
| Brillo, idioma, hora | Brillo (Qix o SysInfo), idioma, hora, batería, pantalla, diagnóstico y registro |
| Cuenta y anuncios | Nada: todo local, exportable como JSON |
