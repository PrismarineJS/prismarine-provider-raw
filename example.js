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
