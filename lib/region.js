const { promisify } = require('util')
const fs = require('fs').promises
const zlib = require('zlib')
const SmartBuffer = require('smart-buffer').SmartBuffer
const assert = require('assert').strict

const deflateAsync = promisify(zlib.deflate)
const inflateAsync = promisify(zlib.inflate)

const MAGIC_BYTES = 'CHNK'
const FORMAT_VERSION = 1
const HEADER_SIZE = 0x200F
const INFO_ENTRIES = 0x400
const INFO_ENTRY_SIZE = 0x8
const MAX_CHUNK_SIZE = 0x100000
const { LightSeparated, BiomesSeparated } = require('./shared_constants')

class RegionFile {
  constructor (path) {
    this.fileName = path
  }

  async initialize (worldVersion, x, z) {
    this.ini = this._initialize(worldVersion, x, z)
    await this.ini
  }

  async _initialize (worldVersion, x, z) {
    this.worldVersion = worldVersion
    this.infoEntries = new Array(INFO_ENTRIES)
    this.allocs = { first: null, last: null }

    try {
      this.file = await fs.open(this.fileName, 'r+')

      const reader = SmartBuffer.fromBuffer((await this.file.read(Buffer.alloc(HEADER_SIZE), 0, HEADER_SIZE, 0)).buffer)
      const magicBytes = reader.readString(4, 'ascii')
      assert.equal(magicBytes, MAGIC_BYTES, `Invalid region file at ${this.fileName}`)
      const regionFormatVersion = reader.readUInt8()
      assert.ok(regionFormatVersion <= FORMAT_VERSION, `Invalid region format version (${regionFormatVersion}) at ${this.fileName}`)
      const regionWorldVersion = reader.readUInt16BE()
      assert.equal(regionWorldVersion, worldVersion, `Invalid region world version (${regionWorldVersion}) at ${this.fileName}`)
      const regionX = reader.readInt32BE()
      const regionZ = reader.readInt32BE()
      assert.ok(regionX === x && regionZ === z, `Invalid region position (${regionX}, ${regionZ}) at ${this.fileName}`)
      const allocations = new Array(INFO_ENTRIES)
      let numAllocations = 0
      for (let i = 0; i < INFO_ENTRIES; ++i) {
        const offset = reader.readUInt32BE()
        const size = reader.readUInt32BE()
        const info = { offset, size }
        let alloc = null
        if (size !== 0) {
          alloc = new AllocationNode(info)
          allocations[numAllocations++] = alloc
        }
        info.alloc = alloc
        this.infoEntries[i] = info
      }
      const sortedAllocations = allocations.slice(0, numAllocations).sort((a, b) => a.info.offset - b.info.offset)
      for (let i = 0; i < sortedAllocations.length; i++) {
        if (this.allocs.first === null) {
          this.allocs.first = sortedAllocations[i]
          this.allocs.last = sortedAllocations[i]
        } else {
          this.allocs.last.setNext(sortedAllocations[i])
          this.allocs.last = sortedAllocations[i]
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err

      this.file = await fs.open(this.fileName, 'w+')

      const writer = SmartBuffer.fromSize(HEADER_SIZE)
      writer.writeString(MAGIC_BYTES)
      writer.writeUInt8(FORMAT_VERSION)
      writer.writeUInt16BE(worldVersion)
      writer.writeInt32BE(x)
      writer.writeInt32BE(z)
      for (let i = 0; i < INFO_ENTRIES; ++i) {
        writer.writeUInt32BE(0)
        writer.writeUInt32BE(0)
        this.infoEntries[i] = { offset: 0, size: 0, alloc: null }
      }
      await this.file.write(writer.toBuffer(), 0, HEADER_SIZE, 0)
    }

    this.size = (await this.file.stat()).size
  }

  /*
   * gets an object representing the chunk data structure returns null if
   * the chunk is not found or an error occurs
   */
  async read (x, z) {
    await this.ini
    if (RegionFile.outOfBounds(x, z)) {
      throw new Error('READ ' + x + ',' + z + ' out of bounds')
    }

    const info = this.getInfo(x, z)
    if (info.size === 0) {
      return null
    }

    if (HEADER_SIZE + info.offset + info.size > this.size) {
      return null
    }

    const reader = SmartBuffer.fromBuffer((await this.file.read(Buffer.alloc(info.size), 0, info.size, HEADER_SIZE + info.offset)).buffer)

    const compression = reader.readUInt8()
    const data = reader.readBuffer()

    return this.parse(compression === 1 ? await inflateAsync(data) : data)
  }

  parse (buffer) {
    const reader = SmartBuffer.fromBuffer(buffer)
    const rawChunk = {
      features: reader.readUInt8(),
      bitMask: reader.readUInt16BE(),
      data: reader.readBuffer(reader.readUInt32BE())
    }
    if (this.worldVersion >= LightSeparated) {
      Object.assign(rawChunk, {
        skyLightMask: reader.readBuffer(3).readUIntBE(0, 3),
        blockLightMask: reader.readBuffer(3).readUIntBE(0, 3),
        emptySkyLightMask: reader.readBuffer(3).readUIntBE(0, 3),
        emptyBlockLightMask: reader.readBuffer(3).readUIntBE(0, 3),
        lightData: reader.readBuffer(reader.readUInt32BE())
      })
    }
    if (this.worldVersion >= BiomesSeparated) {
      Object.assign(rawChunk, {
        biomes: Array.from(reader.readBuffer(0x1000))
      })
    }
    return rawChunk
  }

  /* write a chunk data at (x,z) to disk */
  async write (x, z, chunk, compress = true) {
    await this._write(x, z, chunk, compress)
  }

  async _write (x, z, chunk, compress = true) {
    await this.ini
    const rawChunk = this.serialize(chunk)
    const data = compress ? await deflateAsync(rawChunk) : rawChunk

    const size = data.length + 1
    const info = this.getInfo(x, z)

    // maximum chunk size is 1MB
    if (size >= MAX_CHUNK_SIZE) {
      throw new Error('maximum chunk size is 1MB')
    }

    if (info.size !== 0 && info.size === size) {
      /* we can simply overwrite the old chunk */
      await this.writeChunk(info.offset, data, size, compress)
    } else {
      /* we need to allocate more space */

      // mark old allocation as free
      if (info.alloc) info.alloc.free()

      let start = 0
      let length = 0
      let tmp = this.allocs.first
      while (tmp !== null && length < size) {
        length = tmp.info.offset - start
        start = tmp.info.offset + tmp.info.size
        tmp = tmp.getNext()
      }

      if (length >= size) {
        /* we found a free space large enough */
        if (tmp === null) {
          info.offset = this.allocs.last.offset + this.allocs.last.size
          info.size = size
          info.alloc = new AllocationNode(info)
          this.allocs.last.setNext(info.alloc)
          this.allocs.last = info.alloc
        } else {
          info.offset = tmp.getPrev().info.offset + tmp.getPrev().info.size
          info.size = size
          info.alloc = new AllocationNode(info)
          tmp.insertPrev(info.alloc)
        }
        await this.setInfo(x, z, info)
        await this.writeChunk(info.offset, data, size, compress)
      } else {
        /* no free space large enough found -- we need to grow the file */
        info.offset = this.size - HEADER_SIZE
        info.size = size
        info.alloc = new AllocationNode(info)
        if (this.allocs.last) {
          this.allocs.last.setNext(info.alloc)
          this.allocs.last = info.alloc
        } else { // first allocation
          this.allocs.first = info.alloc
          this.allocs.last = info.alloc
        }
        this.size += size
        await this.setInfo(x, z, info)
        await this.file.write(Buffer.alloc(size), 0, size, this.size - size)
        await this.writeChunk(info.offset, data, size, compress)
      }
    }
  }

  serialize (rawChunk) {
    const writer = new SmartBuffer()
    writer.writeUInt8(rawChunk.features)
    writer.writeUInt16BE(rawChunk.bitMask)
    writer.writeUInt32BE(rawChunk.data.length)
    writer.writeBuffer(rawChunk.data)
    if (this.worldVersion >= LightSeparated) {
      const slBuf = Buffer.alloc(3)
      slBuf.writeUIntBE(rawChunk.skyLightMask, 0, 3)
      writer.writeBuffer(slBuf)
      const blBuf = Buffer.alloc(3)
      blBuf.writeUIntBE(rawChunk.blockLightMask, 0, 3)
      writer.writeBuffer(blBuf)
      const eslBuf = Buffer.alloc(3)
      eslBuf.writeUIntBE(rawChunk.emptySkyLightMask, 0, 3)
      writer.writeBuffer(eslBuf)
      const eblBuf = Buffer.alloc(3)
      eblBuf.writeUIntBE(rawChunk.emptyBlockLightMask, 0, 3)
      writer.writeBuffer(eblBuf)
      writer.writeUInt32BE(rawChunk.lightData.length)
      writer.writeBuffer(rawChunk.lightData)
    }
    if (this.worldVersion >= BiomesSeparated) {
      writer.writeBuffer(Buffer.from(rawChunk.biomes))
    }
    return writer.toBuffer()
  }

  async writeChunk (offset, data, size, compress) {
    const writer = SmartBuffer.fromSize(size + 1)
    writer.writeUInt8(compress ? 1 : 0)
    writer.writeBuffer(data)
    await this.file.write(writer.toBuffer(), 0, writer.length, HEADER_SIZE + offset)
  }

  /* is this an invalid chunk coordinate? */
  static outOfBounds (x, z) {
    return x < 0 || x >= 32 || z < 0 || z >= 32
  }

  getInfo (x, z) {
    return this.infoEntries[x + z * 32]
  }

  async setInfo (x, z, info) {
    this.infoEntries[x + z * 32] = info
    const writer = SmartBuffer.fromSize(INFO_ENTRY_SIZE)
    writer.writeUInt32BE(info.offset)
    writer.writeUInt32BE(info.size)
    await this.file.write(writer.toBuffer(), 0, writer.length, (HEADER_SIZE - (INFO_ENTRIES * INFO_ENTRY_SIZE)) + ((x + z * 32) * INFO_ENTRY_SIZE))
  }

  async close () {
    await this.file.close()
    this.file = null
  };

  async defrag () {
    let freeStart = 0
    let tmp = this.allocs.first
    while (tmp !== null) {
      if (tmp.info.offset > freeStart) {
        const buff = (await this.file.read(Buffer.alloc(tmp.info.size), 0, tmp.info.size, tmp.info.offset + HEADER_SIZE)).buffer
        await this.file.write(buff, 0, tmp.info.size, freeStart + HEADER_SIZE)
        tmp.info.offset = freeStart
      }
      freeStart = tmp.info.offset + tmp.info.size
      tmp = tmp.getNext()
    }
    const newSize = this.allocs.last.info.offset + this.allocs.last.info.size + HEADER_SIZE
    if (this.size > newSize) {
      await this.file.truncate(newSize)
    }
  }
}

class AllocationNode {
  constructor (info) {
    this.info = info
    this.prev = null
    this.next = null
  }

  setPrev (node) {
    this.prev = node
    node.next = this
  }

  setNext (node) {
    this.next = node
    node.prev = this
  }

  getPrev () {
    return this.prev
  }

  getNext () {
    return this.next
  }

  insertPrev (node) {
    this.prev.next = node
    node.prev = this.prev
    node.next = this
    this.prev = node
  }

  insertNext (node) {
    this.next.prev = node
    node.next = this.next
    node.prev = this
    this.next = node
  }

  free () {
    if (this.prev) this.prev.next = this.next
    if (this.next) this.next.prev = this.prev
    this.prev = null
    this.next = null
    this.info.alloc = null
  }
}

module.exports = RegionFile
