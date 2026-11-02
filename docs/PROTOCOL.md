# Protocolo del badge (Jieli RCSP + Qix)

Resumen de lo que implementa `js/rcsp.js` y `js/badge-client.js`. Fuentes: implementación validada en E01 (archivo v4), [AuraCast PROTOCOL.md](https://github.com/Manaiakalani/auracast), [web-bluetooth-e87](https://github.com/hybridherbst/web-bluetooth-e87), [jieli-ble-badge-research](https://github.com/ElectronicCats/jieli-ble-badge-research) y los SDK oficiales de Jieli (`fw-AC63_BT_SDK/include_lib/btstack/third_party/rcsp/JL_rcsp_protocol.h` y `jl_bluetooth_rcsp` del Android SDK).

## GATT

| Servicio | Característica | Uso |
| --- | --- | --- |
| `0000AE00` | `AE01` write / write-without-response | teléfono → badge (auth, RCSP) |
| `0000AE00` | `AE02` notify | badge → teléfono |
| `0000180F` | `2A19` read / notify | batería estándar (no siempre presente) |
| `C2E6FD00-E966-1000-8000-BEF9C223DF6A` (o `FD00`) | `FD02` write | canal Qix 0x9E (hora, idioma, ajustes, batería, pantalla) |
| misma | `FD01` `FD03` `FD05` notify | respuestas Qix |

Nombres anunciados: `E01…`, `E87…`, `E92…`, `L8…`, `X9…`, `LED Badge`, `EC-BADGE`.

## Autenticación (antes de cualquier trama RCSP)

```
tel → [00, r0..r15]            16 bytes aleatorios
bdg → [01, E(r)]               cifrado con la clave estática
tel → [02, 'p','a','s','s']
bdg → [00, c0..c15]            reto del badge
tel → [01, E(c)]
bdg → [02, 'p','a','s','s']    AUTH OK
```

`E()` es el cifrado por bloques de 16 rondas de `libjl_auth` (no es AES): `js/jl-auth.js`. La clave de enlace (`link_key_data`) aparece tal cual en `rcsp_bluetooth.c` del SDK AC63.

## Trama RCSP

```
FE DC BA | flag | opcode | len(BE16) | cuerpo | EF
flag 0xC0 comando con respuesta · 0x80 comando/datos sin respuesta · 0x00 respuesta
comando:   cuerpo = [sn, parámetros…]
respuesta: cuerpo = [estado, sn, parámetros…]   estado 0 OK · 1 error · 2 no soportado · 3 datos · 4 timeout · 5 rechazado
```

### Opcodes (tabla oficial `JL_rcsp_protocol.h`)

| Op | Nombre SDK | Uso en Badge Studio |
| --- | --- | --- |
| 0x01 | DATA | datos de archivo (`[sn, 0x1D, slot, crc16?, bytes]`) y flujo del listado (`[sn, 0x0C, FileStructs…]`) |
| 0x02 | GET_TARGET_FEATURE_MAP | diagnóstico (puede responder NOT_SUPPORTED) |
| 0x03 | GET_TARGET_FEATURE (info) | `[mask BE32, plataforma]` → TLV `len, tipo, datos` (nombre, MAC, versión, MTU…) |
| 0x07 | SYS_INFO_GET | `[función, mask BE32]` → TLV (batería tipo 0, brillo tipo 7, **almacenamiento tipo 2**) |
| 0x08 | SYS_INFO_SET | brillo de respaldo: `[0, 2, 7, valor]` |
| 0x0C | FILE_BROWSE_REQUEST_START | listado (ver abajo) |
| 0x0D | FILE_BROWSE_REQUEST_STOP | lo envía el badge al terminar: `[sn, motivo]`; se responde con estado 0 |
| 0x1B | FILE_TRANSFER_START | `[tamaño BE32, crc16 BE, "nombre.tmp\0"]` → `[tamañoPaquete BE16]` |
| 0x1C | FILE_TRANSFER_END | lo envía el badge: `[sn, motivo]` |
| 0x1D | FILE_TRANSFER (lectura) | lo envía el badge: `[sn, 0, len BE16, offset BE32]` |
| 0x1E | FILE_TRANSFER_CANCEL | error de transferencia |
| 0x1F | FILE_DELETE | `[último, devHandle BE32, tipo(1=archivo), clúster BE32]` |
| 0x20 | FILE_RENAME | lo envía el badge: se responde con el nombre final (`ASCII\0\0` en E01, UTF-16LE en E87) |
| 0x21 | ACTION_PREPARE | `[0]` antes de transferir |
| 0x22 | DEVICE_FORMAT | `[devHandle BE32]` → `[motivo]`; vacía el almacenamiento de medios. Solo desde el botón «Formatear» con doble confirmación |
| 0x23 | ONE_FILE_DELETE | `[0x00, nombre ASCII]` |
| 0x24 | ONE_FILE_TRANS_BACK | lectura de un archivo: `[1, devHandle BE32, offset BE32, clúster BE32]` o `[2, devHandle BE32, offset BE32, unicode, nombre]` → `[op, tamaño BE32]`; datos en tramas `0x01` `[0x24, offset BE32, crc16?, bytes]`; fin `[0x80, ret]` del badge; cancelación `[0x81, motivo]` del teléfono |
| 0x27 | DEVICE_PARM_EXTRA | `[op (0 transferencia / 1 borrado), devHandle BE32, crc16?]` → `[…, 1]` si usa CRC por paquete |
| 0x28 | SIMPLE_FILE_TRANS | archivos pequeños (carátulas); no se usa en badges |

### Almacenamiento (0x07 → atributo tipo 2, formato antiguo)

```
[bits online][USB h32][SD0 h32][SD1 h32][FLASH h32][idx5 h32][reuso]
bit i de "bits online" = dispositivo i presente · el E01 guarda los medios en SD1 (índice 2)
```

El `devHandle` obtenido se usa en 0x27, 0x0C y 0x1F.

### Envío de archivo (validado en E01)

1. `0x07` → handle SD1. (Si el canal Qix existe: latido `9E B5 0B 29 01 00 80` y hora.)
2. `0x21 [0]`.
3. `0x27 [0, handle, 1]` → último byte 1 = CRC-16 por paquete.
4. `0x1B [tamaño, crc16 del archivo, "BADGEST.tmp\0"]` → tamaño de paquete (490 típico).
5. El badge pide ventanas con `0x1D [0, len, offset]`; se responden paquetes `0x01` flag 0x80 con `[0x1D, índice, crc16, datos]`.
6. El badge envía `0x20`; se responde `[0, sn, "NOMBRE.AVI", 0, 0]` (si el nombre existe, vuelve a pedir y el estudio numera).
7. El badge envía `0x1C [sn, 0]`; se responde `[0, sn]`. Fin.

CRC-16/XMODEM: polinomio 0x1021, init 0, sin reflexión (`"123456789"` → `0x31C3`).

### Listado de archivos (`PathData` del SDK Android)

```
0x0C param: [tipo del nodo (0 carpeta / 1 archivo)][cantidad][inicio BE16 (desde 1)][devHandle BE32][pathLen BE16][clústeres BE32…]
respuesta:  [estado, sn, total (1/2/4 bytes, el E01 lo omite)]
```

`tipo` describe el nodo que se abre (`File.convertPathData`: `isFile() ? 1 : 0`), **no** es un filtro: la raíz es una carpeta, así que se pide `tipo=0` con `clústeres=[0]`; una subcarpeta se abre con `tipo=0` y `clústeres=[0, clúster]`. El E01 real responde `estado 0` sin total y luego manda las entradas.

Las entradas **no** vienen en la respuesta: el badge las manda en tramas `0x01` cuyo primer byte de parámetro es `0x0C`, y termina con el comando `0x0D [motivo]`. Cada entrada (`FileStruct.parseData`):

```
[flags][clúster BE32][número BE16][longitud][nombre]
flags: bit0 = archivo · bit1 = NO unicode (GBK) · bits 2-6 = índice de dispositivo
nombre: UTF-16LE si unicode, GBK en caso contrario
```

### Borrado

- Por clúster (`DelDevFileCmd` 0x1F): `[último(1), devHandle BE32, tipo(1 = archivo), clúster BE32]`.
- Por nombre (`DeleteFileByNameCmd` 0x23): `[0x00, nombre ASCII]`. Es el respaldo si 0x1F responde con error, y lo que usa «Borrar por nombre».
- Vaciar todo (`DeviceFormatCmd` 0x22): `[devHandle BE32]`; respuesta `[motivo]` (0 = OK).

### Lectura (vista previa y descarga)

`ReadFileFromDeviceCmd` 0x24 arranca la lectura por clúster o por nombre (nombre unicode = `"\\U"` + UTF-16LE + `00 00`). El badge responde con el tamaño y manda el contenido en tramas DATA `[0x24][offset BE32][crc16 BE si el dispositivo lo soporta][bytes]`, luego el comando `[0x80, ret]`. Para la vista previa se leen ~24 KB, se extrae el primer JPEG (`FF D8 … FF D9`) y se cancela con `[0x81, 0]`.

Observado en el E01 real: el badge envía una ventana de 8 tramas (544 bytes de datos cada una, 4352 en total) y luego manda `[0x80, 0]` aunque falte archivo. Como el inicio acepta `offset`, el estudio vuelve a pedir desde el byte siguiente hasta completar. Queda pendiente capturar qué ACK envía Zrun entre ventanas.

### Identificación del hardware

`0x03` devuelve TLV con los `ATTR_TYPE_*` oficiales: 0 versión de protocolo, 2 dirección EDR, 3 plataforma, 5 versión, 6 `sdk_type` (tabla `JLChipFlag`: 13 = AC707N watch/badge), 7 uboot, 10 VID/PID, 11 auth key, 12 procode, 13 MTU, 17 dirección BLE. El E01 informa `sdk_type = 13`: chip AC707N / BR35, el mismo del E87.

## Canal Qix (0x9E) en FD02

```
9E | checksum (suma de lo que sigue & 0xFF) | flag | cmd | len LE16 | payload
flag: bit7 isRequest · bits 6-3 serie · bit2 isLong · bit1 needResponse · bit0 isResponse
```

| cmd | Uso |
| --- | --- |
| 0x29 `[0x80]` → 0x27 `[cargando, nivel]` | batería |
| 0xC6 `[1]` → 0xC7 `[1, w LE16, h LE16, picW, picH, mem LE32]` | pantalla |
| 0x16 `[0 chino / 1 inglés]` | idioma del menú |
| 0x20 `[0x16, 1, 0, nivel]` | brillo (especulativo, de AuraCast) |
| trama fija `9E 45 08 02 07 00 YY YY MM DD 00 HH mm` | hora |

Todo lo del canal Qix es "best effort": si el servicio no existe (caso habitual en E01) el cliente lo registra y sigue; la ruta de envío validada no depende de él.

## Medios

- AVI RIFF con una sola pista `vids/MJPG`, sin audio, `idx1` presente, cuadros JPEG **baseline**, JFIF, sin segmentos APP1-APP15, sin restart markers, dimensiones múltiplo de 16 (368 = 23 MCU). El codificador propio (`js/jpeg.js`) usa las tablas Huffman estándar del Anexo K: el decodificador del chip dibuja solo las primeras filas con las tablas optimizadas de Chromium.
- 368×368 es lo que muestra el firmware aunque algunos listados digan 384; BW03 y similares usan 240×240.
- Nombres 8.3 en mayúsculas (`BADGE001.AVI`); el estudio numera si el badge rechaza el nombre.
