/* eslint-env jest */

const assert = require('assert').strict
const { Vec3 } = require('vec3')
const rimraf = require('rimraf')

const testedVersions = ['1.8.9', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.1']

describe.each(testedVersions)('saving and loading %s', version => {
  const Chunk = require('prismarine-chunk')(version)
  const RawStorage = require('../')(version)

  describe('error handling', () => {
    afterAll(done => {
      rimraf(path, done)
    })

    it('reading an unsaved chunk returns null', async () => {
      const rawStorage = new RawStorage(path)
      assert.equal(await rawStorage.load(0, 0), null)
      await rawStorage.close()
    })
  })

  function generateRandomChunk (chunkX, chunkZ) {
    const chunk = new Chunk()

    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        chunk.setBiome(new Vec3(x, 0, z), Math.floor(Math.random() * 255))
        for (let y = 0; y < 256; y++) {
          if ((chunkX + chunkZ) % 2 === 0) { // Test global palette based chunks
            if (version === '1.8.9') {
              chunk.setBlockStateId(new Vec3(x, y, z), Math.floor(Math.random() * (2 ** 16 - 1))) // mc 1.8 supports up to 16 bits per block
            } else if (version === '1.9.4' || version === '1.10.2' || version === '1.11.2' || version === '1.12.2') {
              chunk.setBlockStateId(new Vec3(x, y, z), Math.floor(Math.random() * (2 ** 13 - 1))) // mc 1.9 - 1.12 supports up to 13 bits per block
            } else {
              chunk.setBlockStateId(new Vec3(x, y, z), Math.floor(Math.random() * (2 ** 14 - 1))) // mc 1.13+ supports up to 14 bits per block
            }
          } else { // Test section palette based chunks
            chunk.setBlockType(new Vec3(x, y, z), Math.floor(Math.random() * 255))
          }
          if (x === 0 && y === 50 && z === 0) { // ensure (0, 50, 0) has a valid minecraft block for blockType consistency checks in 1.13+
            chunk.setBlockType(new Vec3(x, y, z), 50)
          }
          chunk.setSkyLight(new Vec3(x, y, z), Math.floor(Math.random() * 15))
          chunk.setBlockLight(new Vec3(x, y, z), Math.floor(Math.random() * 15))
        }
      }
    }

    return chunk
  }

  function generateCube (size) {
    return range(size).flatMap((chunkX) => range(size).map(chunkZ => ({ chunkX, chunkZ })))
  }

  const size = 3
  const path = `./world/${version}/`

  async function loadInParallel (chunks) {
    const rawStorage = new RawStorage(path)
    await Promise.all(
      chunks.map(async ({ chunkX, chunkZ, chunk }) => {
        const originalChunk = chunk
        const loadedChunk = await rawStorage.load(chunkX, chunkZ)
        assert.strictEqual(originalChunk.getBlockType(new Vec3(0, 50, 0)), loadedChunk.getBlockType(new Vec3(0, 50, 0)), 'wrong block type at 0,50,0 at chunk ' + chunkX + ', ' + chunkZ)
        assert.ok(originalChunk.dump().equals(loadedChunk.dump()))
        assert.ok(originalChunk.dumpLight() === undefined || originalChunk.dumpLight().equals(loadedChunk.dumpLight()))
        assert.deepEqual(originalChunk.dumpBiomes(), loadedChunk.dumpBiomes())
      })
    )
    await rawStorage.close()
  }

  describe('in sequence', () => {
    let chunks = {}
    beforeAll(() => {
      chunks = generateCube(size).map(({ chunkX, chunkZ }) => ({
        chunkX,
        chunkZ,
        chunk: generateRandomChunk(chunkX, chunkZ)
      }))
    })

    afterAll(done => {
      rimraf(path, done)
    })

    it('save the world in sequence', async () => {
      const rawStorage = new RawStorage(path)
      await chunks.reduce(async (acc, { chunkX, chunkZ, chunk }) => {
        await acc
        await rawStorage.save(chunkX, chunkZ, chunk)
      }, Promise.resolve())
      await rawStorage.close()
    })

    it('defrag the world', async () => {
      const rawStorage = new RawStorage(path)
      await rawStorage.defrag()
      await rawStorage.close()
    })

    it('load the world correctly in parallel', async () => {
      await loadInParallel(chunks)
    })
  })

  describe('in parallel', () => {
    let chunks = {}
    beforeAll(() => {
      chunks = generateCube(size).map(({ chunkX, chunkZ }) => ({
        chunkX,
        chunkZ,
        chunk: generateRandomChunk(chunkX, chunkZ)
      }))
    })

    afterAll(done => {
      rimraf(path, done)
    })

    it('save the world in parallel', async () => {
      const rawStorage = new RawStorage(path)
      await Promise.all(chunks.map(({ chunkX, chunkZ, chunk }) => rawStorage.save(chunkX, chunkZ, chunk)))
      await rawStorage.close()
    })

    it('defrag the world', async () => {
      const rawStorage = new RawStorage(path)
      await rawStorage.defrag()
      await rawStorage.close()
    })

    it('load the world correctly in parallel', async () => {
      await loadInParallel(chunks)
    })
  })
}, 60 * 1000)

function range (n) {
  return [...Array(n).keys()]
}
