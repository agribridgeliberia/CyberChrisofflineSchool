const db = require('../database/database.js')

;(async () => {
  try {
    await db.init()
    const res = await db.verifyUser('admin','admin123')
    console.log('AUTH:', res)
  } catch (err) {
    console.error('ERR', err)
  }
})()
