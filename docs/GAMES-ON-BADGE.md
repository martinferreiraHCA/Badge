# Juegos con la pantalla táctil del badge

## Lo que hace hoy Badge Studio

- Los cinco juegos del Arcade se juegan en el teléfono o la computadora con teclado, pad en pantalla y **táctil** (Snake: deslizar o tocar hacia donde querés ir; Pong, Breakout y Esquivá: arrastrar; Flappy: tocar).
- "Grabar 6 s" convierte la partida en una animación AVI y la guarda en la colección; se envía al badge como cualquier otro contenido.

## Por qué el badge no corre los juegos por sí mismo

El firmware de fábrica (Zrun) es un reproductor de medios: acepta archivos JPEG/AVI por RCSP y los muestra. No existe un comando para enviar código ejecutable ni para leer la pantalla táctil desde el teléfono. Todo lo que recibe por Bluetooth se guarda como archivo en la SD/flash virtual.

## El camino para tener juegos dentro del badge

Hace falta **firmware propio**. El proyecto [ElectronicCats/jieli-ble-badge-research](https://github.com/ElectronicCats/jieli-ble-badge-research) demostró el proceso completo en el E87 (chip JieLi AC707N / BR35, pantalla 360×360 RGB565 por QSPI, táctil AXS5106L, 2 botones, 4 MB NOR):

1. **Volcar el firmware original** por USB o BLE y guardarlo (`docs/dump-firmware.md` de ese repo). Sin esto no hay vuelta atrás.
2. **Compilar el SDK** de Jieli (`fw-AC63`/AC70x) con la placa correcta (`e87` o `dg01`) y empaquetar el `.ufw`.
3. **Flashear por OTA BLE** con `qix-ble` (`docs/ota-howto.md`), usando el servicio FD00 con opcodes 0xC0 y 0xD0-0xD4. La partición `key_mac` conserva la dirección Bluetooth.
4. El firmware propio incluye una interfaz **LVGL táctil**, desbloqueo por deslizamiento, brillo y modo de actualización: la base para un juego.

Sobre esa base, `badge_snake_portable.c` (descargable desde el Arcade) es un núcleo de Snake en C99 sin dependencias: `badge_snake_init`, `badge_snake_turn(dx,dy)` (conectá el táctil o los botones), `badge_snake_tick()` cada ~140 ms y `badge_snake_render(callback)` que entrega píxeles 16×16 para dibujar en LVGL o directo al framebuffer.

## Advertencias

- El E01 **no está cubierto** por esa investigación: antes de flashear hay que identificar chip, panel y controlador táctil, y volcar el firmware original.
- Flashear puede dejar el badge inutilizable. Badge Studio no envía firmware ni comandos de OTA a propósito; solo usa comandos de medios documentados.
- Mientras el badge tenga firmware de fábrica, la experiencia "jugar con el táctil" es la del estudio + grabación.
