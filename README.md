# prismarine-provider-raw
[![NPM version](https://img.shields.io/npm/v/prismarine-provider-raw.svg)](http://npmjs.com/package/prismarine-provider-raw)
[![Build Status](https://github.com/PrismarineJS/prismarine-provider-raw/workflows/CI/badge.svg)](https://github.com/PrismarineJS/prismarine-provider-raw/actions?query=workflow%3A%22CI%22)
[![Discord](https://img.shields.io/badge/chat-on%20discord-brightgreen.svg)](https://discord.gg/GsEFRM8)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-brightgreen.svg)](https://gitter.im/PrismarineJS/general)
[![Irc](https://img.shields.io/badge/chat-on%20irc-brightgreen.svg)](https://irc.gitter.im/)
[![Try it on gitpod](https://img.shields.io/badge/try-on%20gitpod-brightgreen.svg)](https://gitpod.io/#https://github.com/PrismarineJS/prismarine-provider-raw)

Raw ([prismarine-chunk](https://github.com/PrismarineJS/prismarine-chunk) based) Storage Provider implementation. Supports all versions that prismarine-chunk supports thereby providing a stop-gap measure until [prismarine-provider-anvil](https://github.com/PrismarineJS/prismarine-provider-anvil) is updated.

## Usage

```js
const RawStorage = require('prismarine-provider-raw')('1.16.1')
const Chunk = require('prismarine-chunk')('1.16.1')

const storage = new RawStorage('./world/')

const chunk = new Chunk()
storage.save(0, 1, chunk).then(() => {
  console.log('saved!')
  storage.load(0, 1).then(c => {
    console.log('loaded!')
  }).catch(e => {
    console.error(e.stack)
  })
}).catch(e => {
  console.error(e.stack)
})
```

## API

### RawStorage

#### new RawStorage(path, compress = true)
Create a new RawStorage instance which uses the folder at `path` for storage (Optionally disable zlib compression with `compress`)

#### RawStorage.save(x, z, chunk)
Store a prismarine-chunk `chunk` at pos `x`, `y`. Returns a promise.

#### RawStorage.load(x, z)
Load the prismarine-chunk at pos `x`, `y`. Returns a promise.

#### RawStorage.defrag()
Load and defrag all region files (reduces wasted storage space)

NOTE: there is no need to run this regularly

## Format
The format is loosely based on minecraft's Anvil Region format. The world is divided into 32*32 (1024) chunk sections, called 'regions'.
The region a chunk belongs to can be found by dividing and then flooring the chunk coordinates by 32 (Bit-shift right by 5):
```js
const regionX = chunkX >> 5
const regionY = chunkY >> 5
```

### File Header
| Offset | Size (Bytes) | Field              | Purpose                                                                                                                                                           |
|--------|--------------|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0x0    | 0x4          | Magic Number       | CHNK (`43 48 4e 4b`) in ASCII                                                                                                                                     |
| 0x4    | 0x1          | Prismarine Version | Prismarine format version                                                                                                                                         |
| 0x5    | 0x2          | MC World Version   | Minecraft [protocol version](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/common/protocolVersions.json) for the chunks (e.g. 1.16.1 => 736) |
| 0x7    | 0x4          | X Position         | X Position of the region file                                                                                                                                     |
| 0xB    | 0x4          | Y Position         | Y Position of the region file                                                                                                                                     |
| 0xF    | 0x2000       | Chunk Info x1024   | Chunk locations and sizes in the file (see Chunk Info below)                                                                                                      |
| 0x200F | -            | Chunk Data         | Sparse chunk data, referenced by Chunk Info entries, variable size                                                                                                |


### Chunk Info
| Offset | Size (Bytes) | Field  | Purpose                                                      |
|--------|--------------|--------|--------------------------------------------------------------|
| 0x0    | 0x4          | Offset | Chunk data offset, in bytes, after the File Header           |
| 0x4    | 0x4          | Size   | Chunk data size, in bytes                                    |

### Chunk Data
| Offset    | Size (Bytes) | Field                 | Purpose                                                                                            |
|-----------|--------------|-----------------------|----------------------------------------------------------------------------------------------------|
| 0x0       | 0x1          | Compression           | If the rest of the data is GZip compressed or not                                                  |
| 0x1       | 0x1          | Features              | BitMask (0: Full Chunk (Ground Up), 1: Includes SkyLight, 2-7: Reserved)                           |
| 0x2       | 0x2          | BitMask               | Section Bitmask with bits set to 1 for every 16x16x16 chunk section whose data is included in Data |
| 0x4       | 0x4          | Data Length           | Length of the following Block Data                                                                 |
| 0x8       | -            | Data                  | Block Data                                                                                         |
| Unk+0x8   | 0x3          | SkyLight Mask         | Only the first 18 bits are actually used (missing for versions 1.13 and below)                     |
| Unk+0xB   | 0x3          | BlockLight Mask       | Only the first 18 bits are actually used (missing for versions 1.13 and below)                     |
| Unk+0xE   | 0x3          | Empty SkyLight Mask   | Only the first 18 bits are actually used (missing for versions 1.13 and below)                     |
| Unk+0x11  | 0x3          | Empty BlockLight Mask | Only the first 18 bits are actually used (missing for versions 1.13 and below)                     |
| Unk+0x14  | 0x4          | Light Data Length     | Length of the following Light Data (missing for versions 1.13 and below)                           |
| Unk+0x18  | -            | Light Data            | Light Data (missing for versions 1.13 and below)                                                   |
| Unk2+0x18 | 0x1000       | Biomes                | 1024 Biome IDs (missing for versions 1.14 and below)                                               |
