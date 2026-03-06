import { OpenClawBrowser } from './src/services/openclaw-browser'

const browser = new OpenClawBrowser({
  controlUrl: 'http://127.0.0.1:18791',
  token: 'bc3b18e4870a448751b35d5a9999af53',
  profile: 'chrome-work',
})

async function main() {
  console.log('Finding Shopee tab...')
  const targetId = await browser.getTargetId()
  console.log('Target:', targetId)

  console.log('Taking snapshot...')
  const snap = await browser.snapshot()
  console.log('URL:', snap.url)

  // Find refs
  for (const [ref, info] of Object.entries(snap.refs)) {
    if (info.role === 'textbox')
      console.log(`Textbox: ${ref} (name: ${info.name || 'none'})`)
    if (info.name === '發送')
      console.log(`Send button: ${ref}`)
  }

  console.log('\nSending test message...')
  try {
    await browser.sendChatMessage('你好！我是 AIRI 虛擬主播 🎉')
    console.log('Message sent successfully!')
  }
  catch (err) {
    console.error('Failed:', err)
  }
}

main()
