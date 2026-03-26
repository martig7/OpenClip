const fs = require('fs')
const path = require('path')

async function uploadToGoFile(filePath) {
  // Step 1: get an available server
  const serverRes = await fetch('https://api.gofile.io/servers')
  if (!serverRes.ok) throw new Error(`GoFile server lookup failed: ${serverRes.status}`)
  const serverJson = await serverRes.json()
  const server = serverJson?.data?.servers?.[0]?.name
  if (!server) throw new Error('GoFile returned no servers')

  // Step 2: upload
  const fileBuffer = fs.readFileSync(filePath)
  const blob = new Blob([fileBuffer])
  const form = new FormData()
  form.append('file', blob, path.basename(filePath))

  const uploadRes = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
    method: 'POST',
    body: form,
  })
  if (!uploadRes.ok) throw new Error(`GoFile upload failed: ${uploadRes.status}`)
  const uploadJson = await uploadRes.json()
  const url = uploadJson?.data?.downloadPage
  if (!url) throw new Error('GoFile returned no download URL')
  return url
}

async function uploadToCatbox(filePath) {
  const fileBuffer = fs.readFileSync(filePath)
  const blob = new Blob([fileBuffer])
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('fileToUpload', blob, path.basename(filePath))

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Catbox upload failed: ${res.status}`)
  const url = (await res.text()).trim()
  if (!url.startsWith('http')) throw new Error(`Catbox returned unexpected response: ${url}`)
  return url
}

async function uploadToLitterbox(filePath, expiry) {
  const fileBuffer = fs.readFileSync(filePath)
  const blob = new Blob([fileBuffer])
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', expiry || '24h')
  form.append('fileToUpload', blob, path.basename(filePath))

  const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Litterbox upload failed: ${res.status}`)
  const url = (await res.text()).trim()
  if (!url.startsWith('http')) throw new Error(`Litterbox returned unexpected response: ${url}`)
  return url
}

function registerShareHandlers(ipcMain, store) {
  ipcMain.handle('share:upload-clip', async (_event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }

      const shareHost = store.get('settings.shareHost') || 'gofile'
      const litterboxExpiry = store.get('settings.shareLitterboxExpiry') || '24h'

      let url
      if (shareHost === 'catbox') {
        url = await uploadToCatbox(filePath)
      } else if (shareHost === 'litterbox') {
        url = await uploadToLitterbox(filePath, litterboxExpiry)
      } else {
        url = await uploadToGoFile(filePath)
      }

      return { success: true, url }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerShareHandlers }
