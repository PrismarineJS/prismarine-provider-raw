const RawStorage = require('prismarine-provider-raw')('1.16.1')
const Chunk = require('prismarine-chunk')('1.16.1')

const storage = new RawStorage('./world/')

storage.load(0, 1).then(c => {
  console.log('loaded!')
}).catch(e => {
  console.error(e.stack)
})

const chunk = new Chunk()
storage.save(-1, 0, chunk).then(c => {
  console.log('saved!')
}).catch(e => {
  console.error(e.stack)
})
