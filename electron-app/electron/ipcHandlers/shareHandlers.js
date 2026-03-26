const fs = require('fs')
const path = require('path')
const os = require('os')
const { FFMPEG_PATH } = require('../constants')
const ffmpeg = require('fluent-ffmpeg')

// Ensure fluent-ffmpeg uses our bundled ffmpeg
ffmpeg.setFfmpegPath(FFMPEG_PATH)

async function compressClip(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vcodec libx264',
        '-crf 28',         // visually transparent for most gameplay, much smaller
        '-preset fast',
        '-acodec aac',
        '-b:a 128k',
        '-movflags +faststart' // Crucial for Discord/web embeds to play instantly
      ])
      .on('progress', (progress) => {
        if (progress.percent && onProgress) {
          onProgress(progress.percent)
        }
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`Compression failed: ${err.message}`)))
      .save(outputPath)
  })
}

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

async function uploadToUguu(filePath) {
  const fileBuffer = fs.readFileSync(filePath)
  const blob = new Blob([fileBuffer])
  const form = new FormData()
  form.append('files[]', blob, path.basename(filePath))

  const res = await fetch('https://uguu.se/upload', {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Uguu upload failed: ${res.status}`)
  const json = await res.json()
  const url = json?.files?.[0]?.url
  if (!url) throw new Error('Uguu returned no URL')
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
  ipcMain.handle('share:upload-clip', async (event, filePath) => {
    let compressedPath = null
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }

      // Step 1: Compress
      event.sender.send('share:progress', { phase: 'compressing', percent: 0 })
      
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-share-'))
      compressedPath = path.join(tmpDir, `compressed_${path.basename(filePath)}`)
      // Ensure the output has an .mp4 extension for wide compatibility in browsers
      if (!compressedPath.toLowerCase().endsWith('.mp4')) {
         compressedPath += '.mp4'
      }

      await compressClip(filePath, compressedPath, (percent) => {
        event.sender.send('share:progress', { phase: 'compressing', percent })
      })

      // Step 2: Upload
      event.sender.send('share:progress', { phase: 'uploading' })

      const shareHost = store.get('settings.shareHost') || 'catbox'
      const litterboxExpiry = store.get('settings.shareLitterboxExpiry') || '24h'

      let url
      if (shareHost === 'catbox') {
        url = await uploadToCatbox(compressedPath)
      } else if (shareHost === 'litterbox') {
        url = await uploadToLitterbox(compressedPath, litterboxExpiry)
      } else if (shareHost === 'uguu') {
        url = await uploadToUguu(compressedPath)
      } else {
        url = await uploadToGoFile(compressedPath)
      }

      return { success: true, url }
    } catch (err) {
      return { success: false, error: err.message }
    } finally {
      // Clean up the temporary compressed file
      if (compressedPath && fs.existsSync(compressedPath)) {
        try {
          fs.unlinkSync(compressedPath)
          const dir = path.dirname(compressedPath)
          fs.rmdirSync(dir)
        } catch (e) {
          console.error('Failed to cleanup temp compress file:', e)
        }
      }
    }
  })
}

module.exports = { registerShareHandlers }
