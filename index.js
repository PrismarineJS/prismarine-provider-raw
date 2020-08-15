const path = require('path')
const RegionFile = require('./lib/region')
const fs = require('fs')
const assert = require('assert').strict

const { LightSeparated, BiomesSeparated } = require('./lib/shared_constants')
const FULL_CHUNK = 0x1
const SKYLIGHT_SENT = 0x2

module.exports = (mcVersion) => {
  const Chunk = require('prismarine-chunk')(mcVersion)
  const worldVersion = require('minecraft-data').versions.pc.find(x => x.minecraftVersion === mcVersion).version

  assert.ok(typeof worldVersion === 'number', 'Invalid world version!')

  class RawStorage {
    constructor (path, compress = true) {
      this.regions = {}
      this.path = path
      try {
        fs.mkdirSync(path, { recursive: true })
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
      }
      this.compress = compress
    }

    async getRegion (x, z) {
      if (typeof x !== 'number' || typeof z !== 'number') {
        throw new Error('Missing x or z arguments.')
      }
      const regionX = x >> 5
      const regionZ = z >> 5
      const name = path.join(this.path, '/r.' + regionX + '.' + regionZ + '.chnk')
      let region = this.regions[name]
      if (region === undefined) {
        region = new RegionFile(name)
        this.regions[name] = region
        await region.initialize(worldVersion, regionX, regionZ)
      }
      return region
    }

    // returns a Promise. Resolve a Chunk object or reject if it isn't stored
    async load (x, z) {
      const region = await this.getRegion(x, z)
      const rawChunk = await region.read(x & 31, z & 31)
      if (rawChunk == null) return null
      const chunk = new Chunk()
      chunk.load(rawChunk.data, rawChunk.bitMask, (rawChunk.features & SKYLIGHT_SENT) !== 0, (rawChunk.features & FULL_CHUNK) !== 0)
      if (worldVersion >= LightSeparated) chunk.loadLight(rawChunk.lightData, rawChunk.skyLightMask, rawChunk.blockLightMask, rawChunk.emptySkyLightMask, rawChunk.emptyBlockLightMask)
      if (worldVersion >= BiomesSeparated) chunk.loadBiomes(rawChunk.biomes)
      return chunk
    }

    // returns a Promise. Resolve an empty object when successful
    async save (x, z, chunk) {
      const region = await this.getRegion(x, z)
      const rawChunk = {
        features: FULL_CHUNK /* No way to check this in pchunk right now */ | (worldVersion >= LightSeparated || chunk.skyLightSent ? SKYLIGHT_SENT : 0),
        bitMask: chunk.getMask(),
        data: chunk.dump()
      }
      if (worldVersion >= LightSeparated) {
        Object.assign(rawChunk, {
          lightData: chunk.dumpLight(),
          skyLightMask: chunk.skyLightMask,
          blockLightMask: chunk.blockLightMask,
          emptySkyLightMask: 0, // No way to check this in pchunk right now
          emptyBlockLightMask: 0 // No way to check this in pchunk right now
        })
      }
      if (worldVersion >= BiomesSeparated) {
        Object.assign(rawChunk, {
          biomes: chunk.dumpBiomes()
        })
      }
      await region.write(x & 31, z & 31, rawChunk, this.compress)
    }

    async close () {
      for (const region of Object.values(this.regions)) {
        await region.close()
      }
    }

    async defrag () {
      const regionFiles = (await fs.promises.readdir(this.path)).filter(n => n.endsWith('.chnk')) // get list of all stored region files

      const toClose = []

      for (const regionFile of regionFiles) { // preload all missing region files
        const fullPath = path.join(this.path, regionFile)
        if (this.regions[fullPath] === undefined) {
          const region = new RegionFile(fullPath)
          this.regions[fullPath] = region
          const fileNameParts = regionFile.split('.')
          await region.initialize(worldVersion, parseInt(fileNameParts[1] << 5), parseInt(fileNameParts[2]) << 5)
          toClose.push(fullPath)
        }
      }

      for (const region of Object.values(this.regions)) { // defrag each region
        await region.defrag()
      }

      for (const regionName of toClose) { // free regions that were only needed for defragging
        this.regions[regionName].close()
        delete this.regions[regionName]
      }
    }
  }

  return RawStorage
}
